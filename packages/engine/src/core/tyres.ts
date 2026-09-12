import type { Compound } from '../types.ts';

/** Time lost on a completely cold tyre, fading to zero once it is up to temperature. */
export const WARMUP_PENALTY_MS = 900;

/**
 * How much this compound suffers on a track of a given wetness.
 *
 * The three figures a compound carries are anchors at a dry, damp and soaked
 * track; everything between them is interpolated. Without that, a drying track
 * would snap from one set of right answers to another, and the most interesting
 * few laps of a wet race — the ones where nobody is sure yet — would not exist.
 */
function weatherPenaltyAt(compound: Compound, wetness: number): number {
  const clamped = Math.max(0, Math.min(1, wetness));
  const { dry, damp, wet } = compound.weatherPenaltyMs;
  if (clamped <= 0.5) return dry + (damp - dry) * (clamped / 0.5);
  return damp + (wet - damp) * ((clamped - 0.5) / 0.5);
}

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
  wetness: number,
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

  return compound.baseOffsetMs + warmup + degradation + weatherPenaltyAt(compound, wetness);
}

/** Display-only tyre life. The model itself always works from age. */
export function tyreConditionPct(compound: Compound, ageLaps: number, wearFactor: number): number {
  const usableLife = (compound.warmupLaps + compound.cliffLap * 1.7) / wearFactor;
  const pct = 100 * (1 - ageLaps / usableLife);
  return Math.max(0, Math.min(100, Math.round(pct)));
}
