import { describe, expect, it } from 'vitest';
import { TRACKS } from '@undercut/engine';
import { createSeason, recordResult, runRound } from '../src/season.ts';
import {
  clearSeason,
  deserializeSeason,
  loadSeason,
  saveSeason,
  serializeSeason,
  STORAGE_KEY,
  type SeasonStorage,
} from '../src/persistence.ts';
import type { SeasonConfig } from '../src/types.ts';

function memoryStorage(): SeasonStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const config: SeasonConfig = {
  championshipId: 'open-wheel',
  playerTeamId: 'kestros',
  trackIds: TRACKS.slice(0, 2).map((t) => t.id),
  raceLength: 12,
  seed: 'persist',
};

describe('saving a season', () => {
  it('round-trips a season in progress', () => {
    const season = recordResult(createSeason(config), runRound(createSeason(config)));
    const restored = deserializeSeason(serializeSeason(season));
    expect(restored).toEqual(season);
  });

  it('stores and reloads through a storage', () => {
    const storage = memoryStorage();
    const season = createSeason(config);
    saveSeason(season, storage);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(loadSeason(storage)).toEqual(season);
  });

  it('returns nothing when there is no save', () => {
    expect(loadSeason(memoryStorage())).toBeNull();
  });

  it('refuses a save from another schema version', () => {
    const season = createSeason(config);
    const older = JSON.stringify({ ...season, version: 0 });
    expect(deserializeSeason(older)).toBeNull();
  });

  it('refuses junk rather than throwing', () => {
    expect(deserializeSeason('not json at all')).toBeNull();
    expect(deserializeSeason('{"version":1}')).toBeNull();
  });

  it('survives a storage that throws on every call', () => {
    const hostile: SeasonStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveSeason(createSeason(config), hostile)).not.toThrow();
    expect(loadSeason(hostile)).toBeNull();
    expect(() => clearSeason(hostile)).not.toThrow();
  });

  it('clears a save', () => {
    const storage = memoryStorage();
    saveSeason(createSeason(config), storage);
    clearSeason(storage);
    expect(loadSeason(storage)).toBeNull();
  });
});
