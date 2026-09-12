import { describe, expect, it } from 'vitest';
import { createRace, simulate } from '../src/core/race.ts';
import { defaultGrid, TEAMS, teamById } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

function config(laps = 20, weather: RaceConfig['startingWeather'] = 'dry'): RaceConfig {
  return {
    track: trackById('kestrel-park'),
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
    startingWeather: weather,
  };
}

describe('race simulation', () => {
  it('runs to the chequered flag', () => {
    const result = simulate(config(20), 'race-1');
    expect(result.totalLaps).toBe(20);
    expect(result.events.at(-1)?.type).toBe('chequeredFlag');
  });

  it('classifies every entry exactly once', () => {
    const result = simulate(config(20), 'race-2');
    const grid = defaultGrid();
    expect(result.classification).toHaveLength(grid.length);
    expect(new Set(result.classification.map((c) => c.carId)).size).toBe(grid.length);
  });

  it('orders the classification by position with the winner first', () => {
    const result = simulate(config(20), 'race-3');
    const positions = result.classification.map((c) => c.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(result.classification[0]!.position).toBe(1);
    expect(result.classification[0]!.gapToWinnerMs).toBe(0);
  });

  it('never produces an impossible state', () => {
    const result = simulate(config(30), 'race-4');
    for (const car of result.classification) {
      expect(car.lapsCompleted).toBeGreaterThanOrEqual(0);
      expect(car.lapsCompleted).toBeLessThanOrEqual(30);
      expect(car.pitStops).toBeLessThanOrEqual(car.lapsCompleted + 1);
      expect(car.gapToWinnerMs).toBeGreaterThanOrEqual(0);
      if (!car.retired) expect(car.raceTimeMs).toBeGreaterThan(0);
    }
  });

  it('honours a mandatory compound change for cars that finish', () => {
    const result = simulate(config(30), 'race-5');
    const finishers = result.classification.filter((c) => !c.retired);
    expect(finishers.length).toBeGreaterThan(10);
    for (const car of finishers) expect(car.pitStops).toBeGreaterThanOrEqual(1);
  });

  it('steps one lap at a time and reports progress', () => {
    const race = createRace(config(10), 'race-6');
    expect(race.state().lap).toBe(0);
    race.tick();
    expect(race.state().lap).toBe(1);
    expect(race.state().cars.every((c) => c.lapsCompleted === 1 || c.retired)).toBe(true);
    while (!race.isFinished()) race.tick();
    expect(race.state().lap).toBe(10);
    expect(race.result().classification).toHaveLength(defaultGrid().length);
  });

  it('accepts a pit command and executes it on the next lap', () => {
    const race = createRace(config(20), 'race-7');
    race.tick();
    const car = race.state().cars[0]!;
    race.issue({ type: 'pit', car: car.id, compound: 'hard' });
    race.tick();
    const after = race.state().cars.find((c) => c.id === car.id)!;
    expect(after.pitStops).toBe(1);
    expect(after.compound).toBe('hard');
    expect(after.tyreAgeLaps).toBe(0);
  });

  it('accepts a pace command and keeps it until changed', () => {
    const race = createRace(config(20), 'race-8');
    const car = race.state().cars[0]!;
    race.issue({ type: 'pace', car: car.id, mode: 'push' });
    race.tick();
    expect(race.state().cars.find((c) => c.id === car.id)!.paceMode).toBe('push');
    race.tick();
    expect(race.state().cars.find((c) => c.id === car.id)!.paceMode).toBe('push');
  });

  it('burns fuel as the race goes on', () => {
    const race = createRace(config(20), 'race-9');
    const before = race.state().cars[0]!.fuelKg;
    race.tick();
    race.tick();
    const after = race.state().cars.find((c) => c.id === race.state().cars[0]!.id)!.fuelKg;
    expect(after).toBeLessThan(before);
  });

  it('produces a lap time for every running car on every lap', () => {
    const result = simulate(config(15), 'race-10');
    const laps = result.events.filter((e) => e.type === 'lapCompleted');
    expect(laps.length).toBeGreaterThan(15 * 15);
    for (const event of laps) {
      if (event.type !== 'lapCompleted') continue;
      expect(event.lapTimeMs).toBeGreaterThan(30000);
      expect(event.lapTimeMs).toBeLessThan(400000);
    }
  });

  it('runs a wet race without breaking', () => {
    const result = simulate(config(20, 'wet'), 'race-11');
    expect(result.classification).toHaveLength(defaultGrid().length);
    expect(result.events.some((e) => e.type === 'chequeredFlag')).toBe(true);
  });
});

describe('roster overrides', () => {
  it('races the stats it is given rather than the registered ones', () => {
    const grid = defaultGrid();
    const base = simulate(config(20), 'override-base');

    // Hand the slowest team a car a second a lap quicker than anyone else's.
    const boosted = TEAMS.map((team) =>
      team.id === 'corvid' ? { ...team, carPerformance: 1, reliability: 1 } : team,
    );
    const withOverride = simulate(
      { ...config(20), roster: { teams: boosted } },
      'override-base',
    );

    const corvidBefore = base.classification.find((c) => c.teamId === 'corvid')!.position;
    const corvidAfter = withOverride.classification.find((c) => c.teamId === 'corvid')!.position;
    expect(corvidAfter).toBeLessThan(corvidBefore);
    expect(withOverride.classification).toHaveLength(grid.length);
  });

  it('leaves the registered content untouched', () => {
    const before = teamById('corvid').carPerformance;
    simulate(
      {
        ...config(10),
        roster: { teams: [{ ...teamById('corvid'), carPerformance: 1 }] },
      },
      'override-purity',
    );
    expect(teamById('corvid').carPerformance).toBe(before);
  });
});

describe('a grid set by qualifying', () => {
  it('starts the race in the order it is given', () => {
    const reversed = [...defaultGrid()].map((e) => e.carId).reverse();
    const race = createRace({ ...config(10), startingGrid: reversed }, 'grid-order');
    expect(race.state().cars.map((c) => c.id)).toEqual(reversed);
  });

  it('lines up any car missing from the grid behind those on it', () => {
    const entries = defaultGrid();
    const partial = entries.slice(0, 5).map((e) => e.carId);
    const race = createRace({ ...config(10), startingGrid: partial }, 'grid-partial');
    const order = race.state().cars.map((c) => c.id);
    expect(order.slice(0, 5)).toEqual(partial);
    expect(order).toHaveLength(entries.length);
    expect(new Set(order).size).toBe(entries.length);
  });

  it('still qualifies for itself when no grid is supplied', () => {
    const race = createRace(config(10), 'grid-absent');
    expect(race.state().cars).toHaveLength(defaultGrid().length);
  });
});
