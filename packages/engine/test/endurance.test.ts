import { describe, expect, it } from 'vitest';
import { createRace, simulate } from '../src/core/race.ts';
import { trackById } from '../src/content/tracks.ts';
import { ENDURANCE, enduranceOverHours } from '../src/rules/endurance.ts';
import { enduranceGrid } from '../src/content/enduranceGrid.ts';
import { hashEvents } from '../src/replay/hash.ts';
import type { RaceConfig } from '../src/types.ts';

function config(hours = 2): RaceConfig {
  return {
    track: trackById('vantor-ring'),
    regulations: enduranceOverHours(hours),
    entries: enduranceGrid(),
    startingWeather: 'dry',
  };
}

describe('endurance: race length', () => {
  it('runs to a clock, not to a lap count', () => {
    const result = simulate(config(2), 'endurance-1');
    const winner = result.classification[0]!;
    const twoHoursMs = 2 * 3600 * 1000;
    // The race ends on the lap during which the clock runs out, so the winner
    // is past the duration but not by more than one lap.
    expect(winner.raceTimeMs).toBeGreaterThanOrEqual(twoHoursMs);
    expect(winner.raceTimeMs).toBeLessThan(twoHoursMs + 200_000);
  });

  it('covers more laps in a longer race', () => {
    const short = simulate(config(1), 'endurance-2');
    const long = simulate(config(3), 'endurance-2');
    expect(long.classification[0]!.lapsCompleted).toBeGreaterThan(
      short.classification[0]!.lapsCompleted * 2,
    );
  });
});

describe('endurance: classes', () => {
  it('fields every declared class', () => {
    const result = simulate(config(1), 'endurance-3');
    const classes = new Set(result.classification.map((c) => c.classId));
    expect(classes.size).toBe(ENDURANCE.classes.length);
  });

  it('is won overall by a car from the quickest class', () => {
    const quickest = ENDURANCE.classes.reduce((a, b) =>
      a.performanceOffsetMs <= b.performanceOffsetMs ? a : b,
    );
    for (const seed of ['endurance-4', 'endurance-5', 'endurance-6']) {
      const result = simulate(config(1), seed);
      expect(result.classification[0]!.classId).toBe(quickest.id);
    }
  });

  it('numbers positions within each class as well as overall', () => {
    const result = simulate(config(1), 'endurance-7');
    for (const carClass of ENDURANCE.classes) {
      const inClass = result.classification.filter((c) => c.classId === carClass.id);
      expect(inClass.length).toBeGreaterThan(1);
      const positions = inClass.map((c) => c.classPosition);
      expect(positions).toEqual(inClass.map((_, index) => index + 1));
    }
  });

  it('laps the slower classes', () => {
    const result = simulate(config(2), 'endurance-8');
    const top = result.classification[0]!;
    const slowest = [...result.classification]
      .filter((c) => !c.retired)
      .reverse()
      .find((c) => c.classId !== top.classId)!;
    expect(top.lapsCompleted).toBeGreaterThan(slowest.lapsCompleted);
  });
});

describe('endurance: driver stints', () => {
  it('uses every driver in the crew', () => {
    const race = createRace(config(3), 'endurance-9');
    while (!race.isFinished()) race.tick();
    const state = race.state();
    for (const car of state.cars) {
      if (car.retired) continue;
      expect(new Set(car.driversUsed).size).toBeGreaterThanOrEqual(
        ENDURANCE.stints.minDriverCount,
      );
    }
  });

  it('never lets a driver exceed the maximum stint', () => {
    const limit = ENDURANCE.stints.maxDriverStintSeconds!;
    const race = createRace(config(3), 'endurance-10');
    let worst = 0;
    while (!race.isFinished()) {
      race.tick();
      for (const car of race.state().cars) {
        if (!car.retired) worst = Math.max(worst, car.stintSeconds);
      }
    }
    expect(worst).toBeLessThanOrEqual(limit);
  });

  it('reports a driver change on the timing feed', () => {
    const result = simulate(config(2), 'endurance-11');
    const changes = result.events.filter((e) => e.type === 'driverChange');
    expect(changes.length).toBeGreaterThan(5);
  });
});

describe('endurance: fuel', () => {
  it('refuels rather than starting with the whole race on board', () => {
    const race = createRace(config(2), 'endurance-12');
    const tracked = race.state().cars.find((c) => c.classId === 'hypercar')!;
    const capacity = ENDURANCE.classes.find((c) => c.id === 'hypercar')!.fuelCapacityKg!;
    const startingFuel = tracked.fuelKg;
    expect(startingFuel).toBeLessThanOrEqual(capacity + 0.001);

    let refuelled = false;
    let previous = startingFuel;
    while (!race.isFinished()) {
      race.tick();
      const car = race.state().cars.find((c) => c.id === tracked.id)!;
      if (car.fuelKg > previous + 1) refuelled = true;
      expect(car.fuelKg).toBeLessThanOrEqual(capacity + 0.001);
      previous = car.fuelKg;
    }
    expect(refuelled).toBe(true);
  });

  it('puts the quicker classes at the front of the grid', () => {
    const grid = createRace(config(1), 'endurance-grid').state().cars;
    const hypercars = grid.filter((c) => c.classId === 'hypercar').map((c) => c.position);
    const gts = grid.filter((c) => c.classId === 'gt').map((c) => c.position);
    expect(Math.max(...hypercars)).toBeLessThan(Math.min(...gts));
  });

  it('never strands a running car with an empty tank', () => {
    const race = createRace(config(2), 'endurance-13');
    while (!race.isFinished()) {
      race.tick();
      for (const car of race.state().cars) {
        if (!car.retired) expect(car.fuelKg).toBeGreaterThan(0);
      }
    }
  });
});

describe('endurance: determinism', () => {
  it('replays a seed identically', () => {
    const a = simulate(config(1), 'endurance-14');
    const b = simulate(config(1), 'endurance-14');
    expect(hashEvents(a.events)).toBe(hashEvents(b.events));
  });

  it('agrees whether stepped or run in one go', () => {
    const stepped = createRace(config(1), 'endurance-15');
    while (!stepped.isFinished()) stepped.tick();
    expect(hashEvents(stepped.result().events)).toBe(
      hashEvents(simulate(config(1), 'endurance-15').events),
    );
  });
});

describe('open-wheel is unaffected', () => {
  it('still runs a lap-limited race with a single class', async () => {
    const { openWheelOverLaps } = await import('../src/rules/openwheel.ts');
    const { defaultGrid } = await import('../src/content/grid.ts');
    const result = simulate(
      {
        track: trackById('kestrel-park'),
        regulations: openWheelOverLaps(20),
        entries: defaultGrid(),
        startingWeather: 'dry',
      },
      'regression',
    );
    expect(result.totalLaps).toBe(20);
    expect(new Set(result.classification.map((c) => c.classId)).size).toBe(1);
    expect(result.events.some((e) => e.type === 'driverChange')).toBe(false);
  });
});

describe('endurance: running dry', () => {
  it('retires a car whose pit wall never calls a stop', () => {
    // The player's car is not strategised for by the AI, so a pit wall that
    // never boxes must pay for it rather than circulate on an empty tank.
    const race = createRace({ ...config(2), playerCarId: enduranceGrid()[0]!.carId }, 'dry-run');
    const playerId = enduranceGrid()[0]!.carId;
    while (!race.isFinished()) race.tick();
    const player = race.result().classification.find((c) => c.carId === playerId)!;
    expect(player.retired).toBe(true);
    expect(player.retiredCause).toBe('outOfFuel');
    expect(player.pitStops).toBe(0);
  });
});
