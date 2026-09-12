import type { Team, Track } from '../types.ts';
import { sampleAt } from '../rng/streams.ts';

/** How much wing a car can be run with, from stripped to maximum. */
export const DOWNFORCE_RANGE = { min: 0, max: 1 } as const;

/** Lap time given up at the extremes of being wrong about a circuit. */
const SETUP_PENALTY_MS = 1800;
/** Extra tyre load at maximum wing, against none. */
const TYRE_LOAD_SPREAD = 0.3;
/** Extra fuel burn at maximum wing. */
const FUEL_SPREAD = 0.12;
/**
 * Overtaking swing between a stripped car and a maximum-wing one.
 *
 * Deliberately smaller than the lap time being given up. At 900ms a car that
 * threw away a third of a second a lap passed whoever it liked and finished
 * ahead of the setup it should have run, which made "strip the car" the right
 * answer everywhere. Running less wing than a circuit wants should buy you
 * something in traffic, not buy you the race.
 */
const OVERTAKE_SPREAD_MS = 350;

/**
 * Time given up by running the wrong amount of wing for a circuit.
 *
 * Quadratic and symmetric: being a little off costs almost nothing, being a lot
 * off costs real time, and there is no free direction to be wrong in.
 */
export function setupPenaltyMs(track: Pick<Track, 'idealDownforce'>, downforce: number): number {
  const error = downforce - track.idealDownforce;
  return SETUP_PENALTY_MS * error * error;
}

/** Wing presses the car into the road, and the tyres pay for it. */
export function tyreLoadFor(downforce: number): number {
  return 1 - TYRE_LOAD_SPREAD / 2 + TYRE_LOAD_SPREAD * downforce;
}

/** Drag costs fuel. */
export function fuelFactorFor(downforce: number): number {
  return 1 - FUEL_SPREAD / 2 + FUEL_SPREAD * downforce;
}

/**
 * The straight-line advantage one car has over another.
 *
 * A stripped car is quick where passing actually happens, so it both attacks
 * and defends better than a car carrying more wing — which is the whole reason
 * anyone gives up lap time to run less of it.
 */
export function overtakeShiftFor(attackerDownforce: number, defenderDownforce: number): number {
  return (defenderDownforce - attackerDownforce) * OVERTAKE_SPREAD_MS;
}

/**
 * Where a team's engineers land.
 *
 * Nobody finds the optimum exactly, and a well-run team misses it by less. The
 * miss is drawn by key rather than from a stream so that a setup is a property
 * of the weekend rather than of the order things happened to be calculated in.
 */
export function suggestedDownforce(track: Track, team: Team, seed: string): number {
  const quality = Math.max(0, Math.min(1, (team.pitCrewSkill - 0.65) / 0.3));
  const spread = 0.2 - 0.15 * quality;
  const miss = (sampleAt(seed, 'setup', track.id, team.id) - 0.5) * 2 * spread;
  return Math.max(DOWNFORCE_RANGE.min, Math.min(DOWNFORCE_RANGE.max, track.idealDownforce + miss));
}
