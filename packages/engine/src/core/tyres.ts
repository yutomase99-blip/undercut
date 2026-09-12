import type { Compound, WeatherState } from '../types.ts';

/** Time lost on a completely cold tyre, fading to zero once it is up to temperature. */
export const WARMUP_PENALTY_MS = 900;

/**
 * Time a tyre costs relative to the reference lap.
 *
 * Age is a float: a lap spent pushing, or spent in dirty air, ages the tyre by
 * more than one lap. Degradation is gentle up to the cliff and brutal after
 * it, which is what turns "when do I box" into a real decision.
 */
export function tyreDeltaMs(
  compound: Compound,
  ageLaps: number,
  weather: WeatherState,
  wearFactor: number,
): number {
  const warmup =
    ageLaps < compound.warmupLaps
      ? ((compound.warmupLaps - ageLaps) / compound.warmupLaps) * WARMUP_PENALTY_MS
      : 0;

  const workingAge = Math.max(0, ageLaps - compound.warmupLaps);
  const beforeCliff = Math.min(workingAge, compound.cliffLap);
  const afterCliff = Math.max(0, workingAge - compound.cliffLap);
  const degradation =
    (beforeCliff * compound.degPerLapMs +
      afterCliff * compound.degPerLapMs * compound.cliffFactor) *
    wearFactor;

  return compound.baseOffsetMs + warmup + degradation + compound.weatherPenaltyMs[weather];
}

/** Display-only tyre life. The model itself always works from age. */
export function tyreConditionPct(compound: Compound, ageLaps: number, wearFactor: number): number {
  const usableLife = (compound.warmupLaps + compound.cliffLap * 1.7) / wearFactor;
  const pct = 100 * (1 - ageLaps / usableLife);
  return Math.max(0, Math.min(100, Math.round(pct)));
}
