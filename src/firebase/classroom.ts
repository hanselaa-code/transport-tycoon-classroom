import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { db, hasValidFirebaseConfig } from './config';

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
}

export interface ClassroomSession {
  pin: string;
  teacherCreatedAt: number;
  durationMinutes: number;
  endsAt: number;
  scenario: 'standard' | 'boom' | 'challenge';
  active: boolean;
}

const PIN_REGEX = /^[0-9]{4}$/;
const FALLBACK_SESSION_PREFIX = 'tt_classroom_session_';
const FALLBACK_STUDENTS_PREFIX = 'tt_classroom_students_';
const FALLBACK_CHANNEL_NAME = 'tt_classroom_sync_v1';

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeStudentTelemetry(telemetry: StudentTelemetry): StudentTelemetry {
  const cleanId = (telemetry.studentId || 'student-anon').trim().slice(0, 64) || 'student-anon';
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
  };
}

function saveFallbackSession(session: ClassroomSession): void {
  if (!hasBrowserStorage()) return;
  try {
    window.localStorage.setItem(`${FALLBACK_SESSION_PREFIX}${session.pin}`, JSON.stringify(session));
    notifyFallbackChannel(session.pin);
  } catch {
    // Ignore storage quota errors
  }
}

function loadFallbackSession(pin: string): ClassroomSession | null {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = window.localStorage.getItem(`${FALLBACK_SESSION_PREFIX}${pin}`);
    return raw ? (JSON.parse(raw) as ClassroomSession) : null;
  } catch {
    return null;
  }
}

function saveFallbackStudent(pin: string, telemetry: StudentTelemetry): void {
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
  if (!hasBrowserStorage()) return [];
  try {
    const raw = window.localStorage.getItem(`${FALLBACK_STUDENTS_PREFIX}${pin}`);
    return raw ? (JSON.parse(raw) as StudentTelemetry[]) : [];
  } catch {
    return [];
  }
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
  scenario: 'standard' | 'boom' | 'challenge' = 'standard',
): Promise<ClassroomSession> {
  const safeDuration = Math.max(1, Math.min(480, Math.round(safeNumber(durationMinutes, 45))));
  const validScenario: 'standard' | 'boom' | 'challenge' =
    scenario === 'boom' || scenario === 'challenge' ? scenario : 'standard';

  let pin = generateFourDigitPin();
  const now = Date.now();

  if (db && hasValidFirebaseConfig) {
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
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
        endsAt: now + safeDuration * 60_000,
        scenario: validScenario,
        active: true,
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
    endsAt: now + safeDuration * 60_000,
    scenario: validScenario,
    active: true,
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
      const data = snap.data() as ClassroomSession;
      saveFallbackSession(data);
      return data;
    } catch (err) {
      console.warn('[Classroom] Firestore joinClassroomSession failed, checking local fallback:', err);
      return loadFallbackSession(cleanPin);
    }
  }

  return loadFallbackSession(cleanPin);
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
      currentSession = snap.exists() ? (snap.data() as ClassroomSession) : null;
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
        list.push(docSnap.data() as StudentTelemetry);
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
