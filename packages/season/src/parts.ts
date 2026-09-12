import type { Team } from '@undercut/engine';

/**
 * A car as a set of components rather than a single number.
 *
 * "Car performance" was one figure that went up when you spent money on it,
 * which is a spreadsheet rather than a car. Parts give the same budget somewhere
 * to go and something to trade: a quicker engine or a gearbox that will still be
 * there in November.
 */
export const PART_IDS = ['engine', 'aero', 'chassis', 'gearbox', 'suspension'] as const;
export type PartId = (typeof PART_IDS)[number];

export interface Part {
  id: PartId;
  /** How good this component is. Upgrades raise it. */
  level: number;
  /** How much life is left in this one. Racing wears it out. */
  condition: number;
}

export type CarParts = Record<PartId, Part>;

export const PART_LABEL: Record<PartId, string> = {
  engine: 'Engine',
  aero: 'Aerodynamics',
  chassis: 'Chassis',
  gearbox: 'Gearbox',
  suspension: 'Suspension',
};

export const PART_NOTE: Record<PartId, string> = {
  engine: 'Straight-line speed. Wears steadily, and takes reliability with it.',
  aero: 'Cornering and the setup window. The most direct lap time there is.',
  chassis: 'The platform everything else bolts to. Hard-wearing.',
  gearbox: 'Does nothing for lap time and everything for finishing.',
  suspension: 'How kindly the car treats its tyres.',
};

/** What each part contributes to raw pace. Gearbox and suspension contribute none. */
const PACE_WEIGHT: Record<PartId, number> = {
  engine: 0.35,
  aero: 0.35,
  chassis: 0.3,
  gearbox: 0,
  suspension: 0,
};

/** How fast each part wears, per race distance. */
const WEAR_RATE: Record<PartId, number> = {
  engine: 0.12,
  aero: 0.06,
  chassis: 0.04,
  gearbox: 0.1,
  suspension: 0.09,
};

/** A tired component gives less than a fresh one of the same quality. */
const CONDITION_BITE = 0.18;

export function fitPartsFor(team: Pick<Team, 'carPerformance'>): CarParts {
  const parts = {} as CarParts;
  for (const id of PART_IDS) {
    parts[id] = { id, level: team.carPerformance, condition: 1 };
  }
  return parts;
}

/**
 * Raw pace, from the three parts that produce it.
 *
 * Condition matters as well as quality: an engine at the end of its life is not
 * the engine you bought.
 */
export function carPerformanceFrom(parts: CarParts): number {
  let total = 0;
  for (const id of PART_IDS) {
    const weight = PACE_WEIGHT[id];
    if (weight === 0) continue;
    const effective = parts[id].level * (1 - CONDITION_BITE * (1 - parts[id].condition));
    total += weight * effective;
  }
  return Math.max(0, Math.min(1, total));
}

/** Finishing races is the gearbox's job, with the engine's help. */
export function reliabilityFrom(parts: CarParts): number {
  const gearbox = parts.gearbox.level * 0.5 + parts.gearbox.condition * 0.5;
  const engine = parts.engine.condition;
  return Math.max(0.5, Math.min(1, 0.62 + 0.26 * gearbox + 0.12 * engine));
}

/** A tired suspension is hard on tyres. 1 is neutral. */
export function tyreWearFrom(parts: CarParts): number {
  const health = parts.suspension.level * 0.4 + parts.suspension.condition * 0.6;
  return 1.22 - 0.22 * health;
}

/** One race's worth of wear. `distance` is 1 for a normal grand prix. */
export function runWear(parts: CarParts, distance: number): CarParts {
  const worn = {} as CarParts;
  for (const id of PART_IDS) {
    worn[id] = {
      ...parts[id],
      condition: Math.max(0, parts[id].condition - WEAR_RATE[id] * distance),
    };
  }
  return worn;
}

export function partCost(id: PartId, action: 'upgrade' | 'repair'): number {
  const base = action === 'upgrade' ? 70 : 25;
  // A gearbox is cheap to rebuild and dear to improve; aero is the other way.
  const weighting: Record<PartId, number> = {
    engine: 1.15,
    aero: 1,
    chassis: 0.9,
    gearbox: 0.8,
    suspension: 0.85,
  };
  return Math.round(base * weighting[id]);
}

/** Upgrades give more to a weak part than a strong one, as development always did. */
export function upgradePart(parts: CarParts, id: PartId): CarParts {
  const part = parts[id];
  const gain = 0.25 * (1 - part.level) + 0.02;
  return { ...parts, [id]: { ...part, level: Math.min(1, part.level + gain) } };
}

/** A rebuild restores what is left in a part, and changes nothing about its quality. */
export function repairPart(parts: CarParts, id: PartId): CarParts {
  return { ...parts, [id]: { ...parts[id], condition: 1 } };
}
