import { describe, expect, it } from 'vitest';
import { createRace, simulate } from '../src/core/race.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import { hashEvents } from '../src/replay/hash.ts';
import type { RaceConfig } from '../src/types.ts';

function config(laps = 25): RaceConfig {
  return {
    track: trackById('vantor-ring'),
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
    startingWeather: 'dry',
  };
}

describe('determinism', () => {
  it('replays a seed to an identical event log', () => {
    const a = simulate(config(), 'seed-alpha');
    const b = simulate(config(), 'seed-alpha');
    expect(hashEvents(a.events)).toBe(hashEvents(b.events));
    expect(a.classification).toEqual(b.classification);
  });

  it('gives a different race for a different seed', () => {
    const a = simulate(config(), 'seed-alpha');
    const b = simulate(config(), 'seed-beta');
    expect(hashEvents(a.events)).not.toBe(hashEvents(b.events));
  });

  it('reaches the same result whether stepped or run in one go', () => {
    const stepped = createRace(config(), 'seed-gamma');
    while (!stepped.isFinished()) stepped.tick();
    const oneShot = simulate(config(), 'seed-gamma');
    expect(hashEvents(stepped.result().events)).toBe(hashEvents(oneShot.events));
  });

  it('does not read the wall clock or global randomness', async () => {
    // Determinism that is not enforced mechanically decays within a month, so
    // the engine's own sources are scanned for ambient time and randomness.
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const root = new URL('../src', import.meta.url).pathname;

    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.ts')) {
          const source = await readFile(full, 'utf8');
          if (/Math\.random|Date\.now|performance\.now|new Date\(/.test(source)) {
            offenders.push(full.slice(root.length + 1));
          }
        }
      }
    };
    await walk(root);
    expect(offenders).toEqual([]);
  });
});
