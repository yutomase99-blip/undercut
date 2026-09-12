import type { Driver, PaceMode, Team } from '../types.ts';

/** A time penalty, in seconds, added to a car's race at the flag. */
export const PENALTY_SECONDS = 5;
/** Times a car may run wide before the stewards stop being patient. */
export const LIMIT_WARNINGS_ALLOWED = 3;

/**
 * Base chance per lap, before the driver, the pace and the circuit are applied.
 *
 * Set at 0.012 this produced warnings but no penalties at all: across a fifty
 * lap race a car averaged a quarter of a warning and never came close to the
 * four it takes. The mechanic existed and could not be reached, which is worse
 * than not having it.
 */
const LIMIT_BASE = 0.05;
const PACE_RISK: Record<PaceMode, number> = { push: 1.9, hold: 1, save: 0.45 };

/**
 * Chance of putting a wheel beyond the white line on a given lap.
 *
 * This is what stops "push" from being free. Pushing already costs rubber and
 * fuel; it should also occasionally cost five seconds, or the only reason not
 * to push flat out is arithmetic rather than nerve.
 */
export function trackLimitChance(
  driver: Pick<Driver, 'consistency' | 'aggression'>,
  paceMode: PaceMode,
  trackDifficulty: number,
): number {
  const looseness = (1 - driver.consistency) * 0.6 + driver.aggression * 0.4;
  // Tight, walled circuits punish an inch; open ones have run-off to spare.
  const circuit = 0.5 + trackDifficulty;
  return LIMIT_BASE * looseness * PACE_RISK[paceMode] * circuit;
}

/** Chance a stop ends with the car sent out into somebody's path. */
export function unsafeReleaseChance(team: Pick<Team, 'pitCrewSkill'>): number {
  return 0.05 * (1 - team.pitCrewSkill);
}
