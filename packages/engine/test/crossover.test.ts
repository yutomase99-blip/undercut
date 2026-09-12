import { describe, expect, it } from 'vitest';
import { COMPOUNDS } from '../src/content/compounds.ts';
import { tyreDeltaMs } from '../src/core/tyres.ts';
import { DRYING_RATE, WETNESS_FOR, WETTING_RATE, stepWetness } from '../src/core/weather.ts';
import { createRace } from '../src/core/race.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig } from '../src/types.ts';

const soft = COMPOUNDS.soft;
const inter = COMPOUNDS.intermediate;

function config(laps = 40): RaceConfig {
  return {
    track: trackById('monte-cielo'),
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
  };
}

describe('a track is wet by degrees', () => {
  it('matches the old three states at the three anchors', () => {
    expect(tyreDeltaMs(soft, 3, WETNESS_FOR.dry, 1)).toBeCloseTo(
      soft.baseOffsetMs + degOnly(soft, 3) + soft.weatherPenaltyMs.dry,
      6,
    );
    expect(tyreDeltaMs(soft, 3, WETNESS_FOR.damp, 1)).toBeCloseTo(
      soft.baseOffsetMs + degOnly(soft, 3) + soft.weatherPenaltyMs.damp,
      6,
    );
    expect(tyreDeltaMs(soft, 3, WETNESS_FOR.wet, 1)).toBeCloseTo(
      soft.baseOffsetMs + degOnly(soft, 3) + soft.weatherPenaltyMs.wet,
      6,
    );
  });

  it('sits between the anchors in between them', () => {
    const quarter = tyreDeltaMs(soft, 3, 0.25, 1);
    expect(quarter).toBeGreaterThan(tyreDeltaMs(soft, 3, 0, 1));
    expect(quarter).toBeLessThan(tyreDeltaMs(soft, 3, 0.5, 1));
  });

  it('clamps rather than extrapolating past either end', () => {
    expect(tyreDeltaMs(soft, 3, -1, 1)).toBe(tyreDeltaMs(soft, 3, 0, 1));
    expect(tyreDeltaMs(soft, 3, 2, 1)).toBe(tyreDeltaMs(soft, 3, 1, 1));
  });
});

describe('the crossover', () => {
  const at = (wetness: number) => ({
    slick: tyreDeltaMs(soft, 6, wetness, 1),
    inter: tyreDeltaMs(inter, 6, wetness, 1),
  });

  it('exists somewhere in the middle', () => {
    let crossing: number | null = null;
    for (let w = 0; w <= 1.0001; w += 0.01) {
      const { slick, inter: wetTyre } = at(w);
      if (crossing === null && wetTyre < slick) crossing = w;
    }
    expect(crossing).not.toBeNull();
    expect(crossing!).toBeGreaterThan(0.2);
    expect(crossing!).toBeLessThan(0.9);
  });

  it('favours slicks on a nearly dry track and wets on a soaked one', () => {
    expect(at(0.05).slick).toBeLessThan(at(0.05).inter);
    expect(at(0.95).inter).toBeLessThan(at(0.95).slick);
  });

  it('is a window, not a cliff: the two are close either side of it', () => {
    const gapAt = (w: number) => Math.abs(at(w).slick - at(w).inter);
    expect(gapAt(0.54)).toBeLessThan(gapAt(0.05));
    expect(gapAt(0.54)).toBeLessThan(gapAt(0.95));
  });
});

describe('the track takes time to change', () => {
  it('moves towards the conditions rather than snapping to them', () => {
    const next = stepWetness(0, 'wet');
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it('dries more slowly than it wets', () => {
    expect(WETTING_RATE).toBeGreaterThan(DRYING_RATE);
    const wetting = stepWetness(0.5, 'wet') - 0.5;
    const drying = 0.5 - stepWetness(0.5, 'dry');
    expect(wetting).toBeGreaterThan(drying);
  });

  it('arrives eventually and then stays put', () => {
    let wetness = 0;
    for (let i = 0; i < 40; i += 1) wetness = stepWetness(wetness, 'wet');
    expect(wetness).toBeCloseTo(1, 6);
    expect(stepWetness(wetness, 'wet')).toBe(1);
  });

  it('never leaves the range', () => {
    for (const state of ['dry', 'damp', 'wet'] as const) {
      let wetness = state === 'dry' ? 1 : 0;
      for (let i = 0; i < 60; i += 1) {
        wetness = stepWetness(wetness, state);
        expect(wetness).toBeGreaterThanOrEqual(0);
        expect(wetness).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('a race on a drying track', () => {
  it('reports how wet the track is', () => {
    const race = createRace({ ...config(), startingWeather: 'wet' }, 'drying-1');
    expect(race.state().wetness).toBeCloseTo(1, 6);
  });

  it('dries gradually once the rain stops', () => {
    const race = createRace({ ...config(), startingWeather: 'wet' }, 'drying-2');
    const readings: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      race.tick();
      readings.push(race.state().wetness);
    }
    // Never jumps the whole way in one lap, whatever the weather does.
    for (let i = 1; i < readings.length; i += 1) {
      expect(Math.abs(readings[i]! - readings[i - 1]!)).toBeLessThanOrEqual(WETTING_RATE + 1e-9);
    }
  });

  it('starts a dry race on a dry track', () => {
    const race = createRace({ ...config(), startingWeather: 'dry' }, 'drying-3');
    expect(race.state().wetness).toBe(0);
  });

  it('still replays identically', () => {
    const a = createRace(config(), 'drying-determinism');
    const b = createRace(config(), 'drying-determinism');
    while (!a.isFinished()) a.tick();
    while (!b.isFinished()) b.tick();
    expect(a.result().classification).toEqual(b.result().classification);
  });
});

/** Degradation alone, so the anchor test is not just restating the function. */
function degOnly(compound: typeof soft, ageLaps: number): number {
  const workingAge = Math.max(0, ageLaps - compound.warmupLaps);
  const beforeCliff = Math.min(workingAge, compound.cliffLap);
  const afterCliff = Math.max(0, workingAge - compound.cliffLap);
  const warmup =
    ageLaps < compound.warmupLaps
      ? ((compound.warmupLaps - ageLaps) / compound.warmupLaps) * 900
      : 0;
  return warmup + beforeCliff * compound.degPerLapMs + afterCliff * compound.degPerLapMs * compound.cliffFactor;
}
