import type { Regulations } from './regulations.ts';

/** Modern single-seater racing: one class, DRS, a mandatory compound change. */
export const OPEN_WHEEL: Regulations = {
  id: 'open-wheel',
  name: 'Open-Wheel Championship',
  raceLength: { kind: 'laps', laps: 56 },
  classes: [{ id: 'prototype', name: 'Open-Wheel', performanceOffsetMs: 0 }],
  tyreRules: {
    mandatoryCompoundChange: true,
    allowedCompounds: ['soft', 'medium', 'hard', 'intermediate', 'wet'],
  },
  stints: { maxDriverStintSeconds: null, minDriverCount: 1 },
  overtaking: { drsZones: 2, classDifferentialBonusMs: 0 },
  cautions: { kind: 'safetyCar', incidentRatePerLap: 0.0025 },
  attritionScale: 1,
  refuelling: false,
};

/** Builds a variant of the open-wheel rules with a different race distance. */
export function openWheelOverLaps(laps: number): Regulations {
  return { ...OPEN_WHEEL, raceLength: { kind: 'laps', laps } };
}
