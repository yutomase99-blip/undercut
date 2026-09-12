import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/race.ts';
import { TEAMS, defaultGrid } from '../src/content/grid.ts';
import { TRACKS, trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

/**
 * Balance is a property of the content, not a feeling, so it is asserted
 * statistically rather than eyeballed.
 *
 * Two lessons are baked into the shape of this suite.
 *
 * It runs the whole calendar. Measuring one circuit meant one weather profile
 * and one overtaking difficulty standing in for six.
 *
 * Its bars sit close to where the game actually is. A regression once took the
 * bottom four teams from 0.3% of wins to 11.7% and went unnoticed for three
 * features, because the bar was 12% and nothing failed. A threshold loose
 * enough never to be annoying is loose enough never to protect anything.
 */
const RACES_PER_CIRCUIT = 60;

function config(trackId: string): RaceConfig {
  return {
    track: trackById(trackId),
    regulations: openWheelOverLaps(30),
    entries: defaultGrid(),
    // Measured in the dry deliberately. Rain is the loudest source of variance
    // in a race, and this suite is asking about the cars.
    startingWeather: 'dry',
  };
}

interface Season {
  wins: Map<string, number>;
  races: number;
  finished: number;
  starters: number;
}

/** One pass over the calendar, reused by every assertion below. */
function runCalendar(racesPerCircuit = RACES_PER_CIRCUIT): Season {
  const wins = new Map<string, number>();
  let races = 0;
  let finished = 0;
  let starters = 0;

  for (const track of TRACKS) {
    for (let i = 0; i < racesPerCircuit; i += 1) {
      const result = simulate(config(track.id), `balance-${track.id}-${i}`);
      const winner = result.classification[0]!;
      wins.set(winner.teamId, (wins.get(winner.teamId) ?? 0) + 1);
      races += 1;
      finished += result.classification.filter((c) => !c.retired).length;
      starters += result.classification.length;
    }
  }

  return { wins, races, finished, starters };
}

const season = runCalendar();
const share = (teamId: string) => (season.wins.get(teamId) ?? 0) / season.races;
const shareOf = (teams: typeof TEAMS) => teams.reduce((sum, t) => sum + share(t.id), 0);

describe('balance across the calendar', () => {
  it('is won mostly by the three quickest cars', () => {
    expect(shareOf(TEAMS.slice(0, 3))).toBeGreaterThan(0.8);
  });

  it('is almost never won by the four slowest', () => {
    // 4.6% at the time of writing. The bar sits close enough that the kind of
    // regression that took this to 11.7% fails the build.
    expect(shareOf(TEAMS.slice(-4))).toBeLessThan(0.08);
  });

  it('is not owned by any single team', () => {
    expect(Math.max(...[...season.wins.values()]) / season.races).toBeLessThan(0.45);
  });

  it('is open enough that most of the grid can win something', () => {
    expect(season.wins.size).toBeGreaterThanOrEqual(6);
  });

  it('rewards a quicker car over a slower one, all the way down', () => {
    // Not strictly monotonic by design — a good driver in a mediocre car is
    // meant to beat a mediocre driver in a good one — so this compares halves
    // rather than neighbours.
    expect(shareOf(TEAMS.slice(0, 5))).toBeGreaterThan(shareOf(TEAMS.slice(5)) * 4);
  });

  it('finishes most of the field, but not all of it', () => {
    const rate = season.finished / season.starters;
    expect(rate).toBeGreaterThan(0.85);
    expect(rate).toBeLessThan(0.99);
  });
});

describe('every circuit races', () => {
  it('produces a winner everywhere, and not always the same one', () => {
    for (const track of TRACKS) {
      const winners = new Set<string>();
      for (let i = 0; i < 12; i += 1) {
        winners.add(simulate(config(track.id), `circuit-${track.id}-${i}`).classification[0]!.teamId);
      }
      expect(winners.size).toBeGreaterThan(1);
    }
  });
});
