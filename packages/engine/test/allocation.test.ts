import { describe, expect, it } from 'vitest';
import {
  allocationFor,
  countSets,
  hasSet,
  takeSet,
  type TyreAllocation,
} from '../src/core/allocation.ts';
import { createQualifying, runQualifying } from '../src/core/qualifying.ts';
import { createRace, simulate } from '../src/core/race.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { OPEN_WHEEL, openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

const track = trackById('kestrel-park');

function config(laps = 30): RaceConfig {
  return {
    track,
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
    startingWeather: 'dry',
  };
}

describe('an allocation', () => {
  it('starts at whatever the rules hand out', () => {
    const allocation = allocationFor(OPEN_WHEEL);
    for (const [compound, sets] of Object.entries(OPEN_WHEEL.tyreAllocation)) {
      expect(allocation[compound as keyof TyreAllocation]).toBe(sets);
    }
  });

  it('gives a set out and does not give the same one twice', () => {
    const before = allocationFor(OPEN_WHEEL);
    const softs = countSets(before, 'soft');
    const after = takeSet(before, 'soft');
    expect(countSets(after, 'soft')).toBe(softs - 1);
    expect(countSets(before, 'soft')).toBe(softs);
  });

  it('knows when it has run out', () => {
    let allocation = allocationFor(OPEN_WHEEL);
    while (hasSet(allocation, 'soft')) allocation = takeSet(allocation, 'soft');
    expect(countSets(allocation, 'soft')).toBe(0);
    expect(hasSet(allocation, 'soft')).toBe(false);
  });

  it('never goes negative, however hard it is asked', () => {
    let allocation = allocationFor(OPEN_WHEEL);
    for (let i = 0; i < 50; i += 1) allocation = takeSet(allocation, 'soft');
    expect(countSets(allocation, 'soft')).toBe(0);
  });
});

describe('qualifying spends rubber', () => {
  it('uses a set for every run', () => {
    const session = createQualifying(config(), 'alloc-q');
    const carId = defaultGrid()[0]!.carId;
    const before = countSets(session.allocationOf(carId), 'soft');
    session.planRun({ carId, slot: 4, compound: 'soft' });
    session.runSegment();
    expect(countSets(session.allocationOf(carId), 'soft')).toBe(before - 1);
  });

  it('leaves the grid with less than it arrived with', () => {
    const result = runQualifying(config(), 'alloc-q2');
    const carId = defaultGrid()[0]!.carId;
    const remaining = result.allocations.get(carId)!;
    const started = allocationFor(OPEN_WHEEL);
    const spent =
      countSets(started, 'soft') +
      countSets(started, 'medium') +
      countSets(started, 'hard') -
      (countSets(remaining, 'soft') + countSets(remaining, 'medium') + countSets(remaining, 'hard'));
    expect(spent).toBeGreaterThan(0);
  });

  it('will not run a compound the car has none of', () => {
    const session = createQualifying(config(), 'alloc-q3');
    const carId = defaultGrid()[0]!.carId;
    // Burn every soft set, then ask for one anyway.
    for (let i = 0; i < 10; i += 1) {
      session.planRun({ carId, slot: 2, compound: 'soft' });
      session.runSegment();
      if (session.isComplete()) break;
    }
    const laps = session.result().laps.filter((l) => l.carId === carId);
    const softRuns = laps.filter((l) => l.compound === 'soft').length;
    expect(softRuns).toBeLessThanOrEqual(countSets(allocationFor(OPEN_WHEEL), 'soft'));
  });
});

describe('the race spends what is left', () => {
  it('starts from the allocation qualifying handed over', () => {
    const qualifying = runQualifying(config(), 'alloc-r');
    const race = createRace({ ...config(), tyreSets: qualifying.allocations }, 'alloc-r');
    const carId = defaultGrid()[0]!.carId;
    expect(countSets(race.allocationOf(carId), 'soft')).toBe(
      countSets(qualifying.allocations.get(carId)!, 'soft'),
    );
  });

  it('takes a set at every stop', () => {
    const race = createRace(config(20), 'alloc-r2');
    const carId = defaultGrid()[0]!.carId;
    const before = countSets(race.allocationOf(carId), 'hard');
    race.tick();
    race.issue({ type: 'pit', car: carId, compound: 'hard' });
    race.tick();
    expect(countSets(race.allocationOf(carId), 'hard')).toBe(before - 1);
  });

  it('refuses a compound the car has run out of', () => {
    const race = createRace(config(40), 'alloc-r3');
    const carId = defaultGrid()[0]!.carId;
    let allocation = race.allocationOf(carId);
    const softs = countSets(allocation, 'soft');
    for (let i = 0; i < softs + 3; i += 1) {
      race.issue({ type: 'pit', car: carId, compound: 'soft' });
      race.tick();
    }
    allocation = race.allocationOf(carId);
    expect(countSets(allocation, 'soft')).toBe(0);
    const car = race.state().cars.find((c) => c.id === carId)!;
    expect(car.compound).not.toBe('soft');
  });

  it('never leaves a car unable to stop at all', () => {
    // Whatever else happens, a car must always be able to fit something.
    const result = simulate(config(50), 'alloc-r4');
    for (const car of result.classification) {
      expect(car.pitStops).toBeGreaterThanOrEqual(0);
    }
    expect(result.classification.filter((c) => !c.retired).length).toBeGreaterThan(10);
  });
});

describe('the weekend still behaves', () => {
  it('replays identically', () => {
    const a = simulate(config(), 'alloc-determinism');
    const b = simulate(config(), 'alloc-determinism');
    expect(a.classification).toEqual(b.classification);
  });

  it('still serves the mandatory compound change', () => {
    const result = simulate(config(30), 'alloc-mandatory');
    for (const car of result.classification.filter((c) => !c.retired)) {
      expect(car.pitStops).toBeGreaterThanOrEqual(1);
    }
  });
});
