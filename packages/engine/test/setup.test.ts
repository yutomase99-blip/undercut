import { describe, expect, it } from 'vitest';
import {
  DOWNFORCE_RANGE,
  fuelFactorFor,
  overtakeShiftFor,
  setupPenaltyMs,
  suggestedDownforce,
  tyreLoadFor,
} from '../src/core/setup.ts';
import { TRACKS, trackById } from '../src/content/tracks.ts';
import { TEAMS } from '../src/content/grid.ts';
import { simulate, createRace } from '../src/core/race.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

const street = trackById('aurora-bay');
const fast = trackById('nordsee');

function config(laps = 30): RaceConfig {
  return {
    track: trackById('kestrel-park'),
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
    startingWeather: 'dry',
  };
}

describe('what a circuit wants', () => {
  it('asks for more wing where passing is hard and less where it is easy', () => {
    expect(street.idealDownforce).toBeGreaterThan(fast.idealDownforce);
  });

  it('never asks for something outside the range the car can run', () => {
    for (const track of TRACKS) {
      expect(track.idealDownforce).toBeGreaterThanOrEqual(DOWNFORCE_RANGE.min);
      expect(track.idealDownforce).toBeLessThanOrEqual(DOWNFORCE_RANGE.max);
    }
  });
});

describe('the lap-time cost of a setup', () => {
  it('costs nothing at the circuit’s optimum', () => {
    expect(setupPenaltyMs(street, street.idealDownforce)).toBeCloseTo(0, 6);
  });

  it('costs more the further from it you go, in either direction', () => {
    const ideal = street.idealDownforce;
    expect(setupPenaltyMs(street, ideal + 0.2)).toBeGreaterThan(setupPenaltyMs(street, ideal + 0.1));
    expect(setupPenaltyMs(street, ideal - 0.2)).toBeGreaterThan(setupPenaltyMs(street, ideal - 0.1));
  });

  it('punishes being off by the same amount either side', () => {
    const ideal = 0.5;
    const track = { ...street, idealDownforce: ideal };
    expect(setupPenaltyMs(track, ideal + 0.15)).toBeCloseTo(setupPenaltyMs(track, ideal - 0.15), 6);
  });

  it('stays a cost worth weighing rather than a disaster', () => {
    const worst = Math.max(
      setupPenaltyMs(street, DOWNFORCE_RANGE.min),
      setupPenaltyMs(street, DOWNFORCE_RANGE.max),
    );
    expect(worst).toBeGreaterThan(200);
    expect(worst).toBeLessThan(2000);
  });
});

describe('what wing buys and costs', () => {
  it('wears the tyres harder the more of it you run', () => {
    expect(tyreLoadFor(DOWNFORCE_RANGE.max)).toBeGreaterThan(tyreLoadFor(DOWNFORCE_RANGE.min));
  });

  it('burns more fuel the more of it you run', () => {
    expect(fuelFactorFor(DOWNFORCE_RANGE.max)).toBeGreaterThan(fuelFactorFor(DOWNFORCE_RANGE.min));
  });

  it('makes a low-wing car harder to pass and better at passing', () => {
    // A car with less wing has the straight-line speed; one with more is stuck
    // behind it however quick it is through the corners.
    expect(overtakeShiftFor(DOWNFORCE_RANGE.min, DOWNFORCE_RANGE.max)).toBeGreaterThan(0);
    expect(overtakeShiftFor(DOWNFORCE_RANGE.max, DOWNFORCE_RANGE.min)).toBeLessThan(0);
  });

  it('leaves two identical cars on even terms', () => {
    expect(overtakeShiftFor(0.5, 0.5)).toBe(0);
  });
});

describe('what a team lands on', () => {
  it('is close to the circuit’s optimum for a well-run team', () => {
    const best = TEAMS[0]!;
    const chosen = suggestedDownforce(street, best, 'setup-seed');
    expect(Math.abs(chosen - street.idealDownforce)).toBeLessThan(0.12);
  });

  it('is further off for a poorly run one, on average', () => {
    const miss = (team: (typeof TEAMS)[number]) => {
      let total = 0;
      for (let i = 0; i < 200; i += 1) {
        total += Math.abs(suggestedDownforce(street, team, `s-${i}`) - street.idealDownforce);
      }
      return total / 200;
    };
    expect(miss(TEAMS[TEAMS.length - 1]!)).toBeGreaterThan(miss(TEAMS[0]!));
  });

  it('is the same every time for the same team, circuit and seed', () => {
    expect(suggestedDownforce(fast, TEAMS[3]!, 'stable')).toBe(
      suggestedDownforce(fast, TEAMS[3]!, 'stable'),
    );
  });

  it('stays inside the range the car can run', () => {
    for (const track of TRACKS) {
      for (const team of TEAMS) {
        const chosen = suggestedDownforce(track, team, `range-${track.id}-${team.id}`);
        expect(chosen).toBeGreaterThanOrEqual(DOWNFORCE_RANGE.min);
        expect(chosen).toBeLessThanOrEqual(DOWNFORCE_RANGE.max);
      }
    }
  });
});

describe('a race with setups', () => {
  it('lets a car be entered on a chosen setup', () => {
    const entries = defaultGrid().map((e) =>
      e.carId === 'kestros-1' ? { ...e, downforce: DOWNFORCE_RANGE.min } : e,
    );
    const race = createRace({ ...config(), entries }, 'setup-race');
    expect(race.state().cars.find((c) => c.id === 'kestros-1')!.downforce).toBe(
      DOWNFORCE_RANGE.min,
    );
  });

  it('gives every car a setup even when none is named', () => {
    const race = createRace(config(), 'setup-default');
    for (const car of race.state().cars) {
      expect(car.downforce).toBeGreaterThanOrEqual(DOWNFORCE_RANGE.min);
      expect(car.downforce).toBeLessThanOrEqual(DOWNFORCE_RANGE.max);
    }
  });

  it('costs a badly set-up car real places, and the optimum is the best place to be', () => {
    // A distribution, not a single race: one race decides too little, and an
    // earlier version of this test passed or failed on a coin toss.
    const meanFinish = (downforce: number) => {
      let total = 0;
      const races = 40;
      for (let i = 0; i < races; i += 1) {
        const entries = defaultGrid().map((e) =>
          e.teamId === 'meridian' ? { ...e, downforce } : e,
        );
        const result = simulate({ ...config(35), entries }, `setup-curve-${i}`);
        total += result.classification.find((c) => c.carId === 'meridian-1')!.position;
      }
      return total / races;
    };

    const ideal = trackById('kestrel-park').idealDownforce;
    const atOptimum = meanFinish(ideal);
    expect(atOptimum).toBeLessThan(meanFinish(DOWNFORCE_RANGE.min));
    expect(atOptimum).toBeLessThan(meanFinish(DOWNFORCE_RANGE.max));
    expect(atOptimum).toBeLessThan(meanFinish(ideal - 0.25));
    expect(atOptimum).toBeLessThan(meanFinish(ideal + 0.25));
  });

  it('makes being a long way out far worse than being a little out', () => {
    const meanFinish = (downforce: number) => {
      let total = 0;
      const races = 30;
      for (let i = 0; i < races; i += 1) {
        const entries = defaultGrid().map((e) =>
          e.teamId === 'meridian' ? { ...e, downforce } : e,
        );
        total += simulate({ ...config(35), entries }, `setup-slope-${i}`).classification.find(
          (c) => c.carId === 'meridian-1',
        )!.position;
      }
      return total / races;
    };
    const ideal = trackById('kestrel-park').idealDownforce;
    const slightlyOut = meanFinish(ideal - 0.25);
    const wayOut = meanFinish(DOWNFORCE_RANGE.min);
    expect(wayOut - slightlyOut).toBeGreaterThan(3);
  });

  it('still replays identically', () => {
    const a = simulate(config(), 'setup-determinism');
    const b = simulate(config(), 'setup-determinism');
    expect(a.classification).toEqual(b.classification);
  });
});
