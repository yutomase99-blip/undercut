import { describe, expect, it } from 'vitest';
import {
  LIMIT_WARNINGS_ALLOWED,
  PENALTY_SECONDS,
  trackLimitChance,
  unsafeReleaseChance,
} from '../src/core/penalties.ts';
import { createRace, simulate } from '../src/core/race.ts';
import { defaultGrid, TEAMS } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

function config(laps = 40): RaceConfig {
  return {
    track: trackById('aurora-bay'),
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
    startingWeather: 'dry',
  };
}

const steady = { skill: 0.9, consistency: 0.95, aggression: 0.5, id: 'd', name: 'Steady' };
const wild = { skill: 0.9, consistency: 0.6, aggression: 0.95, id: 'w', name: 'Wild' };

describe('running wide', () => {
  it('is likelier when pushing than when holding station', () => {
    expect(trackLimitChance(steady, 'push', 0.5)).toBeGreaterThan(
      trackLimitChance(steady, 'hold', 0.5),
    );
    expect(trackLimitChance(steady, 'hold', 0.5)).toBeGreaterThan(
      trackLimitChance(steady, 'save', 0.5),
    );
  });

  it('is likelier for a driver who lives on the edge', () => {
    expect(trackLimitChance(wild, 'push', 0.5)).toBeGreaterThan(
      trackLimitChance(steady, 'push', 0.5),
    );
  });

  it('is likelier where the walls are close', () => {
    expect(trackLimitChance(steady, 'push', 0.9)).toBeGreaterThan(
      trackLimitChance(steady, 'push', 0.2),
    );
  });

  it('stays a risk rather than a certainty', () => {
    expect(trackLimitChance(wild, 'push', 1)).toBeLessThan(0.2);
    expect(trackLimitChance(steady, 'save', 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('an unsafe release', () => {
  it('is likelier from a poorer crew', () => {
    expect(unsafeReleaseChance(TEAMS[TEAMS.length - 1]!)).toBeGreaterThan(
      unsafeReleaseChance(TEAMS[0]!),
    );
  });

  it('is rare even from the worst of them', () => {
    expect(unsafeReleaseChance(TEAMS[TEAMS.length - 1]!)).toBeLessThan(0.06);
  });
});

describe('penalties in a race', () => {
  it('warns before it punishes', () => {
    const result = simulate(config(60), 'penalty-warnings');
    const warnings = result.events.filter((e) => e.type === 'warning');
    const penalties = result.events.filter(
      (e) => e.type === 'penalty' && e.reason === 'trackLimits',
    );
    expect(warnings.length).toBeGreaterThan(0);
    // Nobody is penalised for track limits without having been warned first.
    for (const penalty of penalties) {
      if (penalty.type !== 'penalty') continue;
      const priorWarnings = warnings.filter(
        (w) => w.type === 'warning' && w.car === penalty.car && w.lap <= penalty.lap,
      );
      expect(priorWarnings.length).toBeGreaterThanOrEqual(LIMIT_WARNINGS_ALLOWED);
    }
  });

  it('adds the time to the car that earned it', () => {
    const race = createRace(config(60), 'penalty-applied');
    while (!race.isFinished()) race.tick();
    const result = race.result();
    for (const car of result.classification) {
      const earned = result.events.filter(
        (e) => e.type === 'penalty' && e.car === car.carId,
      ).length;
      if (earned > 0 && !car.retired) {
        expect(car.penaltyMs).toBeGreaterThanOrEqual(earned * PENALTY_SECONDS * 1000);
      }
    }
  });

  it('can cost a car places at the flag', () => {
    let moved = false;
    for (let i = 0; i < 25 && !moved; i += 1) {
      const result = simulate(config(50), `penalty-order-${i}`);
      const penalised = result.classification.filter((c) => c.penaltyMs > 0 && !c.retired);
      for (const car of penalised) {
        const ahead = result.classification.find((c) => c.position === car.position - 1);
        if (ahead && !ahead.retired && ahead.raceTimeMs < car.raceTimeMs) moved = true;
      }
    }
    expect(moved).toBe(true);
  });

  it('reports what a penalty was for', () => {
    const result = simulate(config(60), 'penalty-reasons');
    for (const event of result.events) {
      if (event.type !== 'penalty') continue;
      expect(['trackLimits', 'unsafeRelease', 'collision']).toContain(event.reason);
    }
  });

  it('is not handed out so often that it stops meaning anything', () => {
    let penalties = 0;
    const races = 20;
    for (let i = 0; i < races; i += 1) {
      penalties += simulate(config(50), `penalty-rate-${i}`).events.filter(
        (e) => e.type === 'penalty',
      ).length;
    }
    const perRace = penalties / races;
    expect(perRace).toBeGreaterThan(0.1);
    expect(perRace).toBeLessThan(4);
  });

  it('still replays identically', () => {
    const a = simulate(config(), 'penalty-determinism');
    const b = simulate(config(), 'penalty-determinism');
    expect(a.classification).toEqual(b.classification);
    expect(a.events.length).toBe(b.events.length);
  });
});
