import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { db, hasValidFirebaseConfig } from './config';

const PIN_REGEX = /^[0-9]{4}$/;
const FALLBACK_MP_PREFIX = 'tt_mp_world_';
const FALLBACK_MP_CHANNEL = 'tt_mp_sync_v1';

const memoryWorldSlices = new Map<string, Map<string, unknown>>();

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : stripUndefinedDeep(item))) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val !== undefined) {
      clean[key] = stripUndefinedDeep(val);
    }
  }
  return clean as T;
}

function worldKey(pin: string, worldIndex: number): string {
  return `${pin}_world-${worldIndex}`;
}

function saveFallbackSlice(pin: string, worldIndex: number, studentId: string, slice: unknown): void {
  const key = worldKey(pin, worldIndex);
  let worldMap = memoryWorldSlices.get(key);
  if (!worldMap) {
    worldMap = new Map<string, unknown>();
    memoryWorldSlices.set(key, worldMap);
  }
  worldMap.set(studentId, slice);

  if (!hasBrowserStorage()) return;
  try {
    const raw = window.localStorage.getItem(`${FALLBACK_MP_PREFIX}${key}`);
    const obj: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    obj[studentId] = slice;
    window.localStorage.setItem(`${FALLBACK_MP_PREFIX}${key}`, JSON.stringify(obj));

    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(FALLBACK_MP_CHANNEL);
      ch.postMessage({ key, ts: Date.now() });
      ch.close();
    }
  } catch {
    // Ignore storage quota errors
  }
}

function loadFallbackPeers(pin: string, worldIndex: number, selfStudentId: string): unknown[] {
  const key = worldKey(pin, worldIndex);
  if (hasBrowserStorage()) {
    try {
      const raw = window.localStorage.getItem(`${FALLBACK_MP_PREFIX}${key}`);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        return Object.entries(obj)
          .filter(([id]) => id !== selfStudentId)
          .map(([, val]) => val);
      }
    } catch {
      // Ignore parse errors
    }
  }
  const worldMap = memoryWorldSlices.get(key);
  if (!worldMap) return [];
  return Array.from(worldMap.entries())
    .filter(([id]) => id !== selfStudentId)
    .map(([, val]) => val);
}

function subscribeFallbackPeers(
  pin: string,
  worldIndex: number,
  selfStudentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPeers: (peers: any[]) => void,
): () => void {
  const key = worldKey(pin, worldIndex);
  const emit = () => {
    onPeers(loadFallbackPeers(pin, worldIndex, selfStudentId));
  };

  emit();

  if (typeof window === 'undefined') {
    return () => {};
  }

  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === `${FALLBACK_MP_PREFIX}${key}`) {
      emit();
    }
  };
  window.addEventListener('storage', onStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(FALLBACK_MP_CHANNEL);
      channel.onmessage = (ev) => {
        if (!ev.data || ev.data.key === key) {
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

export async function publishPlayerWorldSlice(
  pin: string,
  worldIndex: number,
  studentId: string,
  slice: unknown,
): Promise<void> {
  const cleanPin = (pin || '').trim();
  if (!PIN_REGEX.test(cleanPin)) return;

  const safeWorldIndex = Math.max(1, Math.floor(Number.isFinite(worldIndex) ? worldIndex : 1));
  const cleanStudentId = (studentId || '').trim().slice(0, 64);
  if (!cleanStudentId || !slice || typeof slice !== 'object') return;

  const cleanPayload = stripUndefinedDeep({
    ...(slice as Record<string, unknown>),
    clientId: (slice as { clientId?: string }).clientId || cleanStudentId,
    updatedAt: Date.now(),
  });

  if (db && hasValidFirebaseConfig) {
    try {
      await setDoc(
        doc(
          db,
          'classrooms',
          cleanPin,
          'worlds',
          `world-${safeWorldIndex}`,
          'players',
          cleanStudentId,
        ),
        cleanPayload,
      );
      saveFallbackSlice(cleanPin, safeWorldIndex, cleanStudentId, cleanPayload);
      return;
    } catch (err) {
      console.warn('[Multiplayer] Firestore publishPlayerWorldSlice failed, using local fallback:', err);
    }
  }

  saveFallbackSlice(cleanPin, safeWorldIndex, cleanStudentId, cleanPayload);
}

export function subscribeToWorldPeers(
  pin: string,
  worldIndex: number,
  selfStudentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPeers: (peers: any[]) => void,
): () => void {
  const cleanPin = (pin || '').trim();
  if (!PIN_REGEX.test(cleanPin)) {
    onPeers([]);
    return () => {};
  }

  const safeWorldIndex = Math.max(1, Math.floor(Number.isFinite(worldIndex) ? worldIndex : 1));
  const cleanSelfId = (selfStudentId || '').trim().slice(0, 64);

  if (!db || !hasValidFirebaseConfig) {
    return subscribeFallbackPeers(cleanPin, safeWorldIndex, cleanSelfId, onPeers);
  }

  let fallbackCleanup: (() => void) | null = null;
  let disposed = false;

  const unsub = onSnapshot(
    collection(db, 'classrooms', cleanPin, 'worlds', `world-${safeWorldIndex}`, 'players'),
    (snap) => {
      if (disposed || fallbackCleanup) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const peers: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const peerId = (data?.clientId as string | undefined) || docSnap.id;
        if (docSnap.id !== cleanSelfId && peerId !== cleanSelfId) {
          peers.push(data);
        }
      });
      onPeers(peers);
    },
    (err) => {
      if (disposed || fallbackCleanup) return;
      console.warn('[Multiplayer] Firestore subscribeToWorldPeers error, switching to fallback:', err);
      unsub();
      fallbackCleanup = subscribeFallbackPeers(cleanPin, safeWorldIndex, cleanSelfId, onPeers);
    },
  );

  return () => {
    disposed = true;
    unsub();
    if (fallbackCleanup) {
      fallbackCleanup();
    }
  };
}
