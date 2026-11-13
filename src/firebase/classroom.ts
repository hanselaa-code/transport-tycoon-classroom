import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { ADMIN_TEACHER_EMAIL, getCurrentTeacherUser } from './auth';
import { db, hasValidFirebaseConfig } from './config';

export interface WorldSetupConfig {
  mapSize: 64 | 96 | 128 | 160;
  gameMode: 'singleplayer' | 'multiplayer';
  playersPerWorld: number; // 1 in singleplayer; 2..8 in multiplayer
  aiEnabled: boolean;
  maxAiCount: 0 | 1 | 2 | 3;
  terrainType: 'flat' | 'hilly' | 'mountainous';
  waterLevel: 'very_low' | 'low' | 'medium' | 'high';
  townDensity: 'low' | 'normal' | 'high';
  industryDensity: 'low' | 'normal' | 'high';
  startYear: number;
  scenario: 'standard' | 'boom' | 'challenge';
  seed: number;
}

export const DEFAULT_WORLD_SETUP: WorldSetupConfig = {
  mapSize: 64,
  gameMode: 'singleplayer',
  playersPerWorld: 1,
  aiEnabled: true,
  maxAiCount: 3,
  terrainType: 'hilly',
  waterLevel: 'medium',
  townDensity: 'normal',
  industryDensity: 'normal',
  startYear: 1950,
  scenario: 'standard',
  seed: 20261112,
};

export const PLAYER_WORLD_COLORS = [
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#9333ea',
  '#0891b2',
  '#e11d48',
  '#ca8a04',
  '#4f46e5',
] as const;

export interface WorldAssignment {
  studentId: string;
  playerName: string;
  companyName: string;
  worldIndex: number;
  slotInWorld: number;
  playerColor: string;
  assignedAt: number;
}

export interface StudentTelemetry {
  studentId: string;
  studentName: string;
  companyName: string;
  companyValue: number;
  personalNetWorth: number;
  hqTier: number;
  totalTaxPaid: number;
  annualProfit: number;
  updatedAt: number;
  worldIndex: number;
  slotInWorld: number;
  playerColor: string;
}

export interface ClassroomSession {
  pin: string;
  teacherCreatedAt: number;
  durationMinutes: number; // 0 = unlimited timer
  endsAt: number;
  scenario: 'standard' | 'boom' | 'challenge';
  active: boolean;
  worldSetup: WorldSetupConfig;
  assignedCount: number;
  assignments?: Record<string, WorldAssignment>;
  teacherEmail?: string;
}

const PIN_REGEX = /^[0-9]{4}$/;
const FALLBACK_SESSION_PREFIX = 'tt_classroom_session_';
const FALLBACK_STUDENTS_PREFIX = 'tt_classroom_students_';
const FALLBACK_CHANNEL_NAME = 'tt_classroom_sync_v1';

// In-memory store for headless Node/tsx tests where window.localStorage is absent
const memorySessions = new Map<string, ClassroomSession>();
const memoryStudents = new Map<string, Map<string, StudentTelemetry>>();

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeWorldSetup(
  partial?: Partial<WorldSetupConfig> | null,
  fallbackScenario: 'standard' | 'boom' | 'challenge' = 'standard',
): WorldSetupConfig {
  const raw = partial || {};
  const mapSize: 64 | 96 | 128 | 160 =
    raw.mapSize === 96 || raw.mapSize === 128 || raw.mapSize === 160 ? raw.mapSize : 64;
  const gameMode: 'singleplayer' | 'multiplayer' =
    raw.gameMode === 'multiplayer' ? 'multiplayer' : 'singleplayer';
  const rawPerWorld = Math.round(safeNumber(raw.playersPerWorld, gameMode === 'multiplayer' ? 3 : 1));
  const playersPerWorld = gameMode === 'singleplayer' ? 1 : Math.max(2, Math.min(8, rawPerWorld));
  const aiEnabled = typeof raw.aiEnabled === 'boolean' ? raw.aiEnabled : DEFAULT_WORLD_SETUP.aiEnabled;
  const rawMaxAi = raw.maxAiCount;
  const maxAiCount: 0 | 1 | 2 | 3 = !aiEnabled
    ? 0
    : rawMaxAi === 0 || rawMaxAi === 1 || rawMaxAi === 2 || rawMaxAi === 3
      ? rawMaxAi
      : 3;
  const terrainType: 'flat' | 'hilly' | 'mountainous' =
    raw.terrainType === 'flat' || raw.terrainType === 'mountainous' ? raw.terrainType : 'hilly';
  const waterLevel: 'very_low' | 'low' | 'medium' | 'high' =
    raw.waterLevel === 'very_low' ||
    raw.waterLevel === 'low' ||
    raw.waterLevel === 'medium' ||
    raw.waterLevel === 'high'
      ? raw.waterLevel
      : 'medium';
  const townDensity: 'low' | 'normal' | 'high' =
    raw.townDensity === 'low' || raw.townDensity === 'high' ? raw.townDensity : 'normal';
  const industryDensity: 'low' | 'normal' | 'high' =
    raw.industryDensity === 'low' || raw.industryDensity === 'high'
      ? raw.industryDensity
      : 'normal';
  const startYear = Math.max(1920, Math.min(2050, Math.round(safeNumber(raw.startYear, 1950))));
  const scenario: 'standard' | 'boom' | 'challenge' =
    raw.scenario === 'boom' || raw.scenario === 'challenge' || raw.scenario === 'standard'
      ? raw.scenario
      : fallbackScenario;
  const seed = Math.max(1, Math.floor(safeNumber(raw.seed, DEFAULT_WORLD_SETUP.seed)));

  return {
    mapSize,
    gameMode,
    playersPerWorld,
    aiEnabled: maxAiCount > 0 && aiEnabled,
    maxAiCount,
    terrainType,
    waterLevel,
    townDensity,
    industryDensity,
    startYear,
    scenario,
    seed,
  };
}

export function computeWorldBucketAssignment(
  slotIndex: number,
  worldSetup: Pick<WorldSetupConfig, 'gameMode' | 'playersPerWorld'>,
): {
  worldIndex: number;
  slotInWorld: number;
  playerColor: string;
} {
  const safeSlot = Math.max(0, Math.floor(safeNumber(slotIndex, 0)));
  const perWorld =
    worldSetup.gameMode === 'singleplayer'
      ? 1
      : Math.max(1, Math.floor(safeNumber(worldSetup.playersPerWorld, 1)));
  const worldIndex = Math.floor(safeSlot / perWorld) + 1;
  const slotInWorld = (safeSlot % perWorld) + 1;
  const playerColor = PLAYER_WORLD_COLORS[(slotInWorld - 1) % PLAYER_WORLD_COLORS.length];

  return {
    worldIndex,
    slotInWorld,
    playerColor,
  };
}

function normalizeSession(raw: ClassroomSession): ClassroomSession {
  const scenario: 'standard' | 'boom' | 'challenge' =
    raw.scenario === 'boom' || raw.scenario === 'challenge' ? raw.scenario : 'standard';
  const worldSetup = normalizeWorldSetup(raw.worldSetup, scenario);
  const durationMinutes =
    raw.durationMinutes <= 0 ? 0 : Math.min(480, Math.round(safeNumber(raw.durationMinutes, 45)));
  return {
    ...raw,
    durationMinutes,
    endsAt: durationMinutes === 0 ? 0 : safeNumber(raw.endsAt, raw.teacherCreatedAt + durationMinutes * 60_000),
    scenario: worldSetup.scenario,
    worldSetup,
    assignedCount: Math.max(0, Math.floor(safeNumber(raw.assignedCount, 0))),
    assignments: raw.assignments || {},
  };
}

function sanitizeStudentTelemetry(telemetry: StudentTelemetry): StudentTelemetry {
  const cleanId = (telemetry.studentId || 'student-anon').trim().slice(0, 64) || 'student-anon';
  const worldIndex = Math.max(1, Math.floor(safeNumber(telemetry.worldIndex, 1)));
  const slotInWorld = Math.max(1, Math.floor(safeNumber(telemetry.slotInWorld, 1)));
  const defaultColor = PLAYER_WORLD_COLORS[(slotInWorld - 1) % PLAYER_WORLD_COLORS.length];
  const rawColor = (telemetry.playerColor || '').trim();
  return {
    studentId: cleanId,
    studentName: (telemetry.studentName || 'Ukjent elev').trim().slice(0, 100) || 'Ukjent elev',
    companyName: (telemetry.companyName || 'Ukjent AS').trim().slice(0, 100) || 'Ukjent AS',
    companyValue: safeNumber(telemetry.companyValue),
    personalNetWorth: safeNumber(telemetry.personalNetWorth),
    hqTier: Math.max(0, Math.min(5, Math.round(safeNumber(telemetry.hqTier)))),
    totalTaxPaid: safeNumber(telemetry.totalTaxPaid),
    annualProfit: safeNumber(telemetry.annualProfit),
    updatedAt: safeNumber(telemetry.updatedAt, Date.now()),
    worldIndex,
    slotInWorld,
    playerColor: rawColor.length > 0 && rawColor.length <= 24 ? rawColor : defaultColor,
  };
}

function saveFallbackSession(session: ClassroomSession): void {
  memorySessions.set(session.pin, session);
  if (!hasBrowserStorage()) return;
  try {
    window.localStorage.setItem(`${FALLBACK_SESSION_PREFIX}${session.pin}`, JSON.stringify(session));
    notifyFallbackChannel(session.pin);
  } catch {
    // Ignore storage quota errors
  }
}

function loadFallbackSession(pin: string): ClassroomSession | null {
  if (hasBrowserStorage()) {
    try {
      const raw = window.localStorage.getItem(`${FALLBACK_SESSION_PREFIX}${pin}`);
      if (raw) {
        return normalizeSession(JSON.parse(raw) as ClassroomSession);
      }
    } catch {
      // Ignore parse errors
    }
  }
  const mem = memorySessions.get(pin);
  return mem ? normalizeSession(mem) : null;
}

function saveFallbackStudent(pin: string, telemetry: StudentTelemetry): void {
  let pinMap = memoryStudents.get(pin);
  if (!pinMap) {
    pinMap = new Map<string, StudentTelemetry>();
    memoryStudents.set(pin, pinMap);
  }
  pinMap.set(telemetry.studentId, telemetry);

  if (!hasBrowserStorage()) return;
  try {
    const existing = loadFallbackStudents(pin);
    const map = new Map<string, StudentTelemetry>(existing.map((s) => [s.studentId, s]));
    map.set(telemetry.studentId, telemetry);
    window.localStorage.setItem(
      `${FALLBACK_STUDENTS_PREFIX}${pin}`,
      JSON.stringify(Array.from(map.values())),
    );
    notifyFallbackChannel(pin);
  } catch {
    // Ignore storage quota errors
  }
}

function loadFallbackStudents(pin: string): StudentTelemetry[] {
  if (hasBrowserStorage()) {
    try {
      const raw = window.localStorage.getItem(`${FALLBACK_STUDENTS_PREFIX}${pin}`);
      if (raw) {
        return (JSON.parse(raw) as StudentTelemetry[]).map(sanitizeStudentTelemetry);
      }
    } catch {
      // Ignore parse errors
    }
  }
  const pinMap = memoryStudents.get(pin);
  return pinMap ? Array.from(pinMap.values()).map(sanitizeStudentTelemetry) : [];
}

function notifyFallbackChannel(pin: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(FALLBACK_CHANNEL_NAME);
    ch.postMessage({ pin, ts: Date.now() });
    ch.close();
  } catch {
    // Ignore unsupported BroadcastChannel environments
  }
}

function subscribeFallback(
  pin: string,
  onUpdate: (session: ClassroomSession | null, students: StudentTelemetry[]) => void,
): () => void {
  const emit = () => {
    const session = loadFallbackSession(pin);
    const students = loadFallbackStudents(pin).sort((a, b) => b.companyValue - a.companyValue);
    onUpdate(session, students);
  };

  emit();

  if (typeof window === 'undefined') {
    return () => {};
  }

  const onStorage = (e: StorageEvent) => {
    if (
      !e.key ||
      e.key === `${FALLBACK_SESSION_PREFIX}${pin}` ||
      e.key === `${FALLBACK_STUDENTS_PREFIX}${pin}`
    ) {
      emit();
    }
  };
  window.addEventListener('storage', onStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(FALLBACK_CHANNEL_NAME);
      channel.onmessage = (ev) => {
        if (!ev.data || ev.data.pin === pin) {
          emit();
        }
      };
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener('storage', onStorage);
    if (channel) {
      channel.close();
    }
  };
}

function generateFourDigitPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function isFirebaseConfigured(): boolean {
  return Boolean(db && hasValidFirebaseConfig);
}

export async function createClassroomSession(
  durationMinutes: number,
  scenarioOrSetup?: 'standard' | 'boom' | 'challenge' | Partial<WorldSetupConfig>,
): Promise<ClassroomSession> {
  const safeDuration =
    durationMinutes <= 0 ? 0 : Math.min(480, Math.round(safeNumber(durationMinutes, 45)));

  const now = Date.now();
  const defaultSeed = (now % 89999999) + 10000000;

  const worldSetup =
    typeof scenarioOrSetup === 'string'
      ? normalizeWorldSetup({ scenario: scenarioOrSetup, seed: defaultSeed }, scenarioOrSetup)
      : normalizeWorldSetup(
          { seed: defaultSeed, ...(scenarioOrSetup || {}) },
          scenarioOrSetup?.scenario || 'standard',
        );

  const teacher = getCurrentTeacherUser();
  const isBrowser = typeof window !== 'undefined';

  if (isBrowser && (!teacher || teacher.email !== ADMIN_TEACHER_EMAIL)) {
    throw new Error(
      'Kun innlogget lærer (hanselaa@gmail.com) kan opprette nye klasseroms-økter.',
    );
  }

  let pin = generateFourDigitPin();

  if (db && hasValidFirebaseConfig && teacher?.email === ADMIN_TEACHER_EMAIL) {
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = attempt === 0 ? pin : generateFourDigitPin();
        const existingSnap = await getDoc(doc(db, 'classrooms', candidate));
        if (!existingSnap.exists()) {
          pin = candidate;
          break;
        }
      }

      const session: ClassroomSession = {
        pin,
        teacherCreatedAt: now,
        durationMinutes: safeDuration,
        endsAt: safeDuration === 0 ? 0 : now + safeDuration * 60_000,
        scenario: worldSetup.scenario,
        active: true,
        worldSetup,
        assignedCount: 0,
        assignments: {},
        teacherEmail: teacher.email,
      };

      await setDoc(doc(db, 'classrooms', pin), session);
      saveFallbackSession(session);
      return session;
    } catch (err) {
      console.warn('[Classroom] Firestore createClassroomSession failed, falling back to local sync:', err);
    }
  }

  const fallbackSession: ClassroomSession = {
    pin,
    teacherCreatedAt: now,
    durationMinutes: safeDuration,
    endsAt: safeDuration === 0 ? 0 : now + safeDuration * 60_000,
    scenario: worldSetup.scenario,
    active: true,
    worldSetup,
    assignedCount: 0,
    assignments: {},
    teacherEmail: teacher?.email || ADMIN_TEACHER_EMAIL,
  };
  saveFallbackSession(fallbackSession);
  return fallbackSession;
}

export async function joinClassroomSession(pin: string): Promise<ClassroomSession | null> {
  const cleanPin = (pin || '').trim();
  if (!PIN_REGEX.test(cleanPin)) {
    return null;
  }

  if (db && hasValidFirebaseConfig) {
    try {
      const snap = await getDoc(doc(db, 'classrooms', cleanPin));
      if (!snap.exists()) {
        return loadFallbackSession(cleanPin);
      }
      const data = normalizeSession(snap.data() as ClassroomSession);
      saveFallbackSession(data);
      return data;
    } catch (err) {
      console.warn('[Classroom] Firestore joinClassroomSession failed, checking local fallback:', err);
      return loadFallbackSession(cleanPin);
    }
  }

  return loadFallbackSession(cleanPin);
}

function assignStudentInLocalSession(
  localSession: ClassroomSession,
  cleanStudentId: string,
  cleanPlayerName: string,
  cleanCompanyName: string,
): {
  session: ClassroomSession;
  worldIndex: number;
  slotInWorld: number;
  playerColor: string;
} {
  const normalized = normalizeSession(localSession);
  const existing = normalized.assignments?.[cleanStudentId];
  if (existing) {
    return {
      session: normalized,
      worldIndex: existing.worldIndex,
      slotInWorld: existing.slotInWorld,
      playerColor: existing.playerColor,
    };
  }

  const slotIndex = normalized.assignedCount ?? 0;
  const { worldIndex, slotInWorld, playerColor } = computeWorldBucketAssignment(
    slotIndex,
    normalized.worldSetup,
  );
  const assignment: WorldAssignment = {
    studentId: cleanStudentId,
    playerName: cleanPlayerName,
    companyName: cleanCompanyName,
    worldIndex,
    slotInWorld,
    playerColor,
    assignedAt: Date.now(),
  };

  const updatedSession: ClassroomSession = {
    ...normalized,
    assignedCount: slotIndex + 1,
    assignments: {
      ...(normalized.assignments || {}),
      [cleanStudentId]: assignment,
    },
  };
  saveFallbackSession(updatedSession);
  return {
    session: updatedSession,
    worldIndex,
    slotInWorld,
    playerColor,
  };
}

export async function joinClassroomWithWorldAssignment(
  pin: string,
  studentId: string,
  playerName: string,
  companyName: string,
): Promise<{
  ok: boolean;
  session?: ClassroomSession;
  worldIndex?: number;
  slotInWorld?: number;
  playerColor?: string;
  error?: string;
}> {
  const cleanPin = (pin || '').trim();
  if (!PIN_REGEX.test(cleanPin)) {
    return {
      ok: false,
      error: 'PIN-koden må bestå av nøyaktig 4 siffer.',
    };
  }

  const cleanPlayerName = (playerName || '').trim().slice(0, 80);
  if (!cleanPlayerName) {
    return {
      ok: false,
      error: 'Skriv inn ditt spillnavn før du starter.',
    };
  }

  const cleanCompanyName =
    (companyName || '').trim().slice(0, 80) || `${cleanPlayerName} AS`;
  const cleanStudentId =
    (studentId || '').trim().slice(0, 64) || `student-${Date.now()}`;

  if (db && hasValidFirebaseConfig) {
    try {
      const sessionRef = doc(db, 'classrooms', cleanPin);
      const txResult = await runTransaction(db, async (tx) => {
        const snap = await tx.get(sessionRef);
        if (!snap.exists()) {
          return { status: 'not_found' as const };
        }

        const rawData = snap.data() as ClassroomSession;
        if (rawData.active === false) {
          return { status: 'inactive' as const };
        }

        const normalized = normalizeSession(rawData);
        const existingAssignments = { ...(normalized.assignments || {}) };
        const existing = existingAssignments[cleanStudentId];

        if (existing) {
          if (
            existing.playerName !== cleanPlayerName ||
            existing.companyName !== cleanCompanyName
          ) {
            const updatedExisting: WorldAssignment = {
              ...existing,
              playerName: cleanPlayerName,
              companyName: cleanCompanyName,
            };
            const nextAssignments = {
              ...existingAssignments,
              [cleanStudentId]: updatedExisting,
            };
            tx.update(sessionRef, {
              assignments: nextAssignments,
            });
            return {
              status: 'ok' as const,
              session: { ...normalized, assignments: nextAssignments },
              worldIndex: updatedExisting.worldIndex,
              slotInWorld: updatedExisting.slotInWorld,
              playerColor: updatedExisting.playerColor,
            };
          }

          return {
            status: 'ok' as const,
            session: normalized,
            worldIndex: existing.worldIndex,
            slotInWorld: existing.slotInWorld,
            playerColor: existing.playerColor,
          };
        }

        const slotIndex = normalized.assignedCount ?? 0;
        const { worldIndex, slotInWorld, playerColor } = computeWorldBucketAssignment(
          slotIndex,
          normalized.worldSetup,
        );
        const newAssignment: WorldAssignment = {
          studentId: cleanStudentId,
          playerName: cleanPlayerName,
          companyName: cleanCompanyName,
          worldIndex,
          slotInWorld,
          playerColor,
          assignedAt: Date.now(),
        };

        const nextAssignedCount = slotIndex + 1;
        const nextAssignments = {
          ...existingAssignments,
          [cleanStudentId]: newAssignment,
        };

        tx.update(sessionRef, {
          assignedCount: nextAssignedCount,
          assignments: nextAssignments,
        });

        return {
          status: 'ok' as const,
          session: {
            ...normalized,
            assignedCount: nextAssignedCount,
            assignments: nextAssignments,
          },
          worldIndex,
          slotInWorld,
          playerColor,
        };
      });

      if (txResult.status === 'inactive') {
        return {
          ok: false,
          error: 'Denne klasseroms-økten er avsluttet av læreren.',
        };
      }

      if (txResult.status === 'ok') {
        saveFallbackSession(txResult.session);
        return {
          ok: true,
          session: txResult.session,
          worldIndex: txResult.worldIndex,
          slotInWorld: txResult.slotInWorld,
          playerColor: txResult.playerColor,
        };
      }

      // Check local/memory fallback if not found in Firestore (e.g. offline/headless test)
      const local = loadFallbackSession(cleanPin);
      if (!local) {
        return {
          ok: false,
          error: `Fant ingen aktiv klasseroms-økt med PIN ${cleanPin}. Sjekk koden på tavla!`,
        };
      }
      const localAssigned = assignStudentInLocalSession(
        local,
        cleanStudentId,
        cleanPlayerName,
        cleanCompanyName,
      );
      return {
        ok: true,
        ...localAssigned,
      };
    } catch (err) {
      console.warn('[Classroom] Firestore joinClassroomWithWorldAssignment failed, checking local fallback:', err);
      const local = loadFallbackSession(cleanPin);
      if (local) {
        const localAssigned = assignStudentInLocalSession(
          local,
          cleanStudentId,
          cleanPlayerName,
          cleanCompanyName,
        );
        return {
          ok: true,
          ...localAssigned,
        };
      }
      return {
        ok: false,
        error: 'Kunne ikke koble til klasseroms-økten. Sjekk nettverk og PIN-kode.',
      };
    }
  }

  const local = loadFallbackSession(cleanPin);
  if (!local) {
    return {
      ok: false,
      error: `Fant ingen aktiv klasseroms-økt med PIN ${cleanPin}.`,
    };
  }
  const localAssigned = assignStudentInLocalSession(
    local,
    cleanStudentId,
    cleanPlayerName,
    cleanCompanyName,
  );
  return {
    ok: true,
    ...localAssigned,
  };
}

export async function pushStudentTelemetry(
  pin: string,
  telemetry: StudentTelemetry,
): Promise<void> {
  const cleanPin = (pin || '').trim();
  if (!PIN_REGEX.test(cleanPin)) {
    return;
  }

  const cleanTelemetry = sanitizeStudentTelemetry({
    ...telemetry,
    updatedAt: telemetry.updatedAt || Date.now(),
  });

  if (db && hasValidFirebaseConfig) {
    try {
      await setDoc(
        doc(db, 'classrooms', cleanPin, 'students', cleanTelemetry.studentId),
        cleanTelemetry,
      );
      saveFallbackStudent(cleanPin, cleanTelemetry);
      return;
    } catch (err) {
      console.warn('[Classroom] Firestore pushStudentTelemetry failed, saving to local fallback:', err);
    }
  }

  saveFallbackStudent(cleanPin, cleanTelemetry);
}

export function subscribeToClassroom(
  pin: string,
  onUpdate: (session: ClassroomSession | null, students: StudentTelemetry[]) => void,
): () => void {
  const cleanPin = (pin || '').trim();
  if (!PIN_REGEX.test(cleanPin)) {
    onUpdate(null, []);
    return () => {};
  }

  if (!db || !hasValidFirebaseConfig) {
    return subscribeFallback(cleanPin, onUpdate);
  }

  let currentSession: ClassroomSession | null = null;
  let currentStudents: StudentTelemetry[] = [];
  let sessionLoaded = false;
  let studentsLoaded = false;
  let fallbackCleanup: (() => void) | null = null;
  let disposed = false;

  const emitIfReady = () => {
    if (disposed || fallbackCleanup) return;
    if (sessionLoaded || studentsLoaded) {
      onUpdate(currentSession, currentStudents);
    }
  };

  const activateFallback = (err: unknown) => {
    if (disposed || fallbackCleanup) return;
    console.warn('[Classroom] Firestore subscription error, switching to local fallback:', err);
    unsubSession();
    unsubStudents();
    fallbackCleanup = subscribeFallback(cleanPin, onUpdate);
  };

  const unsubSession = onSnapshot(
    doc(db, 'classrooms', cleanPin),
    (snap) => {
      sessionLoaded = true;
      currentSession = snap.exists() ? normalizeSession(snap.data() as ClassroomSession) : null;
      if (currentSession) {
        saveFallbackSession(currentSession);
      }
      emitIfReady();
    },
    activateFallback,
  );

  const unsubStudents = onSnapshot(
    collection(db, 'classrooms', cleanPin, 'students'),
    (snap) => {
      studentsLoaded = true;
      const list: StudentTelemetry[] = [];
      snap.forEach((docSnap) => {
        list.push(sanitizeStudentTelemetry(docSnap.data() as StudentTelemetry));
      });
      list.sort((a, b) => b.companyValue - a.companyValue);
      currentStudents = list;
      emitIfReady();
    },
    activateFallback,
  );

  return () => {
    disposed = true;
    unsubSession();
    unsubStudents();
    if (fallbackCleanup) {
      fallbackCleanup();
    }
  };
}
