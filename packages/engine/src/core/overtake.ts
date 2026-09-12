export interface OvertakeInput {
  /** How much faster the attacker is this lap, in milliseconds. */
  paceAdvantageMs: number;
  attackerAggression: number;
  defenderSkill: number;
  /** 0 = passing is trivial, 1 = passing is near impossible. */
  trackDifficulty: number;
  /** Extra help when a faster class closes on a slower one. */
  classDifferentialBonusMs: number;
  drsZones: number;
}

/** Pace advantage at which a move is, on a neutral circuit, a formality. */
const DECISIVE_ADVANTAGE_MS = 1800;

/**
 * Probability that an attempted pass sticks this lap.
 *
 * A car that is not actually faster keeps a sliver of a chance — a lunge, a
 * mistake ahead — but only a sliver.
 */
export function overtakeChance(input: OvertakeInput): number {
  const advantageMs = input.paceAdvantageMs + input.classDifferentialBonusMs;
  if (advantageMs <= 0) return Math.max(0, 0.01 + advantageMs / 100_000);

  const raw = advantageMs / DECISIVE_ADVANTAGE_MS;
  const drs = 1 + input.drsZones * 0.12;
  const duel = 1 + (input.attackerAggression - input.defenderSkill) * 0.45;
  const circuit = 1 - input.trackDifficulty * 0.85;

  return Math.max(0, Math.min(1, raw * drs * duel * circuit));
}
