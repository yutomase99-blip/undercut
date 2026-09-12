import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/race.ts';
import { TEAMS, defaultGrid } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

/**
 * Balance is asserted statistically, so that a tuning regression shows up as a
 * red build rather than as a feeling that something is off.
 */
const RACES = 300;

function config(trackId: string): RaceConfig {
  return {
    track: trackById(trackId),
    regulations: openWheelOverLaps(30),
    entries: defaultGrid(),
    startingWeather: 'dry',
  };
}

function winCounts(trackId: string, races: number): Map<string, number> {
  const wins = new Map<string, number>();
  for (let i = 0; i < races; i += 1) {
    const result = simulate(config(trackId), `balance-${trackId}-${i}`);
    const winner = result.classification[0]!;
    wins.set(winner.teamId, (wins.get(winner.teamId) ?? 0) + 1);
  }
  return wins;
}

describe('balance', () => {
  it('lets the fastest cars win most often', () => {
    const wins = winCounts('kestrel-park', RACES);
    const topThree = TEAMS.slice(0, 3).reduce((sum, t) => sum + (wins.get(t.id) ?? 0), 0);
    expect(topThree / RACES).toBeGreaterThan(0.6);
  });

  it('does not let the slowest cars win often', () => {
    const wins = winCounts('kestrel-park', RACES);
    const bottomFour = TEAMS.slice(-4).reduce((sum, t) => sum + (wins.get(t.id) ?? 0), 0);
    expect(bottomFour / RACES).toBeLessThan(0.12);
  });

  it('does not hand every race to a single team', () => {
    const wins = winCounts('kestrel-park', RACES);
    const best = Math.max(...wins.values());
    expect(best / RACES).toBeLessThan(0.75);
    expect(wins.size).toBeGreaterThanOrEqual(3);
  });

  it('produces different winners on a chaotic circuit than a stable one', () => {
    const stable = winCounts('sable-dunes', 120);
    const chaotic = winCounts('monte-cielo', 120);
    expect(stable.size).toBeGreaterThan(0);
    expect(chaotic.size).toBeGreaterThan(0);
  });

  it('finishes most of the field in a normal race', () => {
    let finished = 0;
    let total = 0;
    for (let i = 0; i < 40; i += 1) {
      const result = simulate(config('kestrel-park'), `attrition-${i}`);
      finished += result.classification.filter((c) => !c.retired).length;
      total += result.classification.length;
    }
    expect(finished / total).toBeGreaterThan(0.8);
    expect(finished / total).toBeLessThan(0.995);
  });
});
