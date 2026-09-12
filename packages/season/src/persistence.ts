import { SEASON_VERSION } from './season.ts';
import type { SeasonState } from './types.ts';

export const STORAGE_KEY = 'undercut.season.v1';

/** The small slice of the Storage API this needs, so it can be tested without a DOM. */
export interface SeasonStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): SeasonStorage | null {
  try {
    return (globalThis as { localStorage?: SeasonStorage }).localStorage ?? null;
  } catch {
    // Access itself throws in some privacy modes.
    return null;
  }
}

export function serializeSeason(season: SeasonState): string {
  return JSON.stringify(season);
}

/**
 * Reads a saved season back.
 *
 * Anything unreadable or from a different schema version returns null rather
 * than throwing: a corrupt save should cost the player their season, not the
 * ability to open the game at all.
 */
export function deserializeSeason(text: string): SeasonState | null {
  try {
    const parsed = JSON.parse(text) as Partial<SeasonState>;
    if (!parsed || parsed.version !== SEASON_VERSION) return null;
    if (!parsed.config || !Array.isArray(parsed.teams) || !Array.isArray(parsed.entries)) return null;
    if (!Array.isArray(parsed.results) || typeof parsed.round !== 'number') return null;
    return parsed as SeasonState;
  } catch {
    return null;
  }
}

export function saveSeason(season: SeasonState, storage: SeasonStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, serializeSeason(season));
  } catch {
    // A full or blocked store is not worth interrupting a race for.
  }
}

export function loadSeason(storage: SeasonStorage | null = defaultStorage()): SeasonState | null {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? deserializeSeason(text) : null;
  } catch {
    return null;
  }
}

export function clearSeason(storage: SeasonStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the save is already unreachable.
  }
}
