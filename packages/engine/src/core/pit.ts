import type { Team, Track } from '../types.ts';
import type { Rng } from '../rng/streams.ts';

/** No crew on earth beats this. */
export const MIN_STATIONARY_MS = 1900;
/** Probability a stop goes wrong: a cross-threaded wheel nut, a slow release. */
export const BOTCH_CHANCE = 0.04;

/** Time the car spends stationary in the box. */
export function pitStopMs(team: Team, rng: Rng): number {
  const base = 2350 + (1 - team.pitCrewSkill) * 1600;
  const jitter = rng.normal(0, 180);
  const botch = rng.chance(BOTCH_CHANCE) ? 3000 + rng.next() * 5200 : 0;
  return Math.max(MIN_STATIONARY_MS, base + jitter + botch);
}

/** Total time a stop costs against staying out: pit lane plus the stop itself. */
export function totalPitLossMs(track: Track, stationaryMs: number): number {
  return track.pitLaneLossMs + stationaryMs;
}
