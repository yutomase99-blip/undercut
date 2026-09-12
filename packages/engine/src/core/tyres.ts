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

/**
 * How many laps there are in a set before there is nothing left of it.
 *
 * Past this the tyre is not merely slow, it is finished: the carcass is going
 * and it is a question of when, not whether.
 */
export function usableLifeLaps(compound: Compound, wearFactor: number): number {
  return (compound.warmupLaps + compound.cliffLap * 1.7) / wearFactor;
}

/** Display-only tyre life. The model itself always works from age. */
export function tyreConditionPct(compound: Compound, ageLaps: number, wearFactor: number): number {
  const pct = 100 * (1 - ageLaps / usableLifeLaps(compound, wearFactor));
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Chance per lap that a tyre run past its life simply lets go.
 *
 * Without this a set could be run indefinitely: forty-five minutes of endurance
 * racing on softs cost six and a half seconds a lap and nothing else, so the
 * only thing stopping it was arithmetic. A tyre needs an end, not just a
 * gradient.
 */
export function tyreFailureChance(
  compound: Compound,
  ageLaps: number,
  wearFactor: number,
): number {
  const over = ageLaps - usableLifeLaps(compound, wearFactor);
  if (over <= 0) return 0;
  return Math.min(0.4, 0.025 * over);
}
