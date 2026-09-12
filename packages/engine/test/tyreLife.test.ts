import { describe, expect, it } from 'vitest';
import { COMPOUNDS } from '../src/content/compounds.ts';
import {
  tyreConditionPct,
  tyreDeltaMs,
  tyreFailureChance,
  usableLifeLaps,
} from '../src/core/tyres.ts';
import { createRace, simulate } from '../src/core/race.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { enduranceGrid } from '../src/content/enduranceGrid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import { enduranceOverHours } from '../src/rules/endurance.ts';
import type { RaceConfig } from '../src/types.ts';

const soft = COMPOUNDS.soft;
const hard = COMPOUNDS.hard;

describe('a tyre has a life', () => {
  it('lasts longer the harder it is', () => {
    expect(usableLifeLaps(hard, 1)).toBeGreaterThan(usableLifeLaps(soft, 1));
  });

  it('lasts less on a circuit that eats tyres', () => {
    expect(usableLifeLaps(soft, 1.4)).toBeLessThan(usableLifeLaps(soft, 0.8));
  });

  it('reaches nothing left exactly when its life runs out', () => {
    const life = usableLifeLaps(soft, 1);
    expect(tyreConditionPct(soft, life - 1, 1)).toBeGreaterThan(0);
    expect(tyreConditionPct(soft, life, 1)).toBe(0);
  });
});

describe('running a tyre past its life', () => {
  it('cannot fail while there is life left in it', () => {
    expect(tyreFailureChance(soft, usableLifeLaps(soft, 1) - 1, 1)).toBe(0);
  });

  it('becomes likelier the further past it you go', () => {
    const life = usableLifeLaps(soft, 1);
    expect(tyreFailureChance(soft, life + 6, 1)).toBeGreaterThan(
      tyreFailureChance(soft, life + 2, 1),
    );
  });

  it('is close to certain if you simply keep going', () => {
    const life = usableLifeLaps(soft, 1);
    // Fifteen laps past the end of a soft tyre should not be a viable plan.
    const survives = (1 - tyreFailureChance(soft, life + 8, 1)) ** 8;
    expect(survives).toBeLessThan(0.25);
  });

  it('falls off a real cliff on lap time as well', () => {
    const cliff = soft.cliffLap + soft.warmupLaps;
    const justAfter = tyreDeltaMs(soft, cliff + 3, 0, 1) - tyreDeltaMs(soft, cliff, 0, 1);
    const wellBefore = tyreDeltaMs(soft, 5, 0, 1) - tyreDeltaMs(soft, 2, 0, 1);
    expect(justAfter).toBeGreaterThan(wellBefore * 5);
  });
});

describe('in a race', () => {
  function sprint(laps = 40): RaceConfig {
    return {
      track: trackById('kestrel-park'),
      regulations: openWheelOverLaps(laps),
      entries: defaultGrid(),
      startingWeather: 'dry',
    };
  }

  it('punishes a pit wall that never calls a stop', () => {
    // The complaint that prompted this: forty-five minutes of endurance racing
    // on one set of softs, with nothing to stop it. Naming a player car is what
    // creates that situation — the AI strategises every other car, and a
    // well-run car never runs a tyre into the ground.
    const playerCarId = defaultGrid()[0]!.carId;
    const race = createRace({ ...sprint(50), playerCarId }, 'never-stops');
    const failures: number[] = [];
    while (!race.isFinished()) {
      for (const event of race.tick()) {
        if (event.type === 'tyreFailure' && event.car === playerCarId) failures.push(event.lap);
      }
    }
    expect(failures.length).toBeGreaterThan(0);
  });

  it('reports a failure and puts the car back in the pits', () => {
    const playerCarId = defaultGrid()[0]!.carId;
    const result = simulate({ ...sprint(50), playerCarId }, 'failure-report');
    const failure = result.events.find((e) => e.type === 'tyreFailure');
    expect(failure).toBeDefined();
    if (failure?.type !== 'tyreFailure') return;

    expect(failure.ageLaps).toBeGreaterThan(10);
    const stopAfter = result.events.find(
      (e) => e.type === 'pitStop' && e.car === failure.car && e.lap >= failure.lap,
    );
    expect(stopAfter).toBeDefined();
  });

  it('costs the car real time when it happens', () => {
    const playerCarId = defaultGrid()[0]!.carId;
    const withFailures = simulate({ ...sprint(50), playerCarId }, 'failure-cost');
    const player = withFailures.classification.find((c) => c.carId === playerCarId)!;
    const failures = withFailures.events.filter(
      (e) => e.type === 'tyreFailure' && e.car === playerCarId,
    ).length;
    if (failures > 0) {
      expect(player.position).toBeGreaterThan(5);
    }
  });

  it('does not make failures a normal part of a well-run race', () => {
    let failures = 0;
    const races = 20;
    for (let i = 0; i < races; i += 1) {
      failures += simulate(sprint(40), `failure-rate-${i}`).events.filter(
        (e) => e.type === 'tyreFailure',
      ).length;
    }
    // A handful across twenty races: the cars that gambled, not the whole field.
    expect(failures / races).toBeLessThan(1.5);
  });

  it('stops a soft tyre lasting a whole endurance stint', () => {
    const result = simulate(
      {
        track: trackById('vantor-ring'),
        regulations: enduranceOverHours(1),
        entries: enduranceGrid().map((e) => ({ ...e, startingCompound: 'soft' as const })),
        startingWeather: 'dry',
      },
      'endurance-softs',
    );
    const stops = result.events.filter((e) => e.type === 'pitStop').length;
    expect(stops).toBeGreaterThan(enduranceGrid().length);
  });
});
