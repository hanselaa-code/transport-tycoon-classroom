import { GameState } from '../types/game';

export const SAVE_STORAGE_KEY = 'tt_classroom_save_v1';

const memoryStorageFallback = new Map<string, string>();

function getStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, val: string): void;
  removeItem(key: string): void;
} {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore restricted storage environments and fall back to memory map
  }
  return {
    getItem: (key) => memoryStorageFallback.get(key) ?? null,
    setItem: (key, val) => {
      memoryStorageFallback.set(key, val);
    },
    removeItem: (key) => {
      memoryStorageFallback.delete(key);
    },
  };
}

export interface SaveEnvelope {
  version: 1;
  savedAt: number;
  state: GameState;
}

export function serializeGameState(state: GameState): string {
  const cleanState: GameState = {
    ...state,
    popups: [],
    lastSavedAtMs: Date.now(),
  };
  const envelope: SaveEnvelope = {
    version: 1,
    savedAt: cleanState.lastSavedAtMs!,
    state: cleanState,
  };
  return JSON.stringify(envelope);
}

export function deserializeGameState(rawJson: string): {
  ok: boolean;
  state?: GameState;
  error?: string;
} {
  try {
    const parsed = JSON.parse(rawJson) as Partial<SaveEnvelope> & Partial<GameState>;
    const candidate: Partial<GameState> =
      parsed && typeof parsed === 'object' && 'state' in parsed && parsed.state
        ? parsed.state
        : (parsed as Partial<GameState>);

    if (
      !candidate ||
      typeof candidate.mapSize !== 'number' ||
      !Array.isArray(candidate.tiles) ||
      !Array.isArray(candidate.towns) ||
      !Array.isArray(candidate.industries) ||
      !Array.isArray(candidate.stations) ||
      !Array.isArray(candidate.vehicles) ||
      !candidate.corporate ||
      !candidate.personal ||
      !candidate.date
    ) {
      return { ok: false, error: 'Ugyldig lagringsfil: mangler nødvendige spilldata.' };
    }

    const restored: GameState = {
      mapSize: candidate.mapSize,
      tiles: candidate.tiles,
      towns: candidate.towns,
      industries: candidate.industries,
      stations: candidate.stations,
      vehicles: candidate.vehicles,
      popups: [],
      date: candidate.date,
      speed: candidate.speed ?? 1,
      corporate: candidate.corporate,
      personal: candidate.personal,
      aiCompanies: Array.isArray(candidate.aiCompanies) ? candidate.aiCompanies : [],
      news: Array.isArray(candidate.news) ? candidate.news : [],
      scenario: candidate.scenario ?? 'standard',
      networkRevision: (candidate.networkRevision ?? 0) + 1,
      lastSavedAtMs: candidate.lastSavedAtMs ?? Date.now(),
    };

    return { ok: true, state: restored };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunne ikke lese JSON-lagringsfil.',
    };
  }
}

export function saveStateToLocalStorage(state: GameState): boolean {
  try {
    const json = serializeGameState(state);
    getStorage().setItem(SAVE_STORAGE_KEY, json);
    state.lastSavedAtMs = Date.now();
    return true;
  } catch {
    return false;
  }
}

export function loadStateFromLocalStorage(): GameState | null {
  try {
    const json = getStorage().getItem(SAVE_STORAGE_KEY);
    if (!json) return null;
    const res = deserializeGameState(json);
    return res.ok && res.state ? res.state : null;
  } catch {
    return null;
  }
}

export function hasSavedStateInLocalStorage(): boolean {
  try {
    return getStorage().getItem(SAVE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSavedStateInLocalStorage(): void {
  try {
    getStorage().removeItem(SAVE_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
