import type { CarClass } from '../types.ts';
import type { Regulations } from './regulations.ts';

/**
 * Three classes sharing one circuit. The performance offsets are what make
 * traffic the defining feature of the category: a Hypercar closing on a GT is
 * eleven seconds a lap quicker, and has to get past without losing the race.
 */
export const ENDURANCE_CLASSES: CarClass[] = [
  { id: 'hypercar', name: 'Hypercar', performanceOffsetMs: 0, fuelCapacityKg: 68 },
  { id: 'lmp2', name: 'LMP2', performanceOffsetMs: 4200, fuelCapacityKg: 75 },
  { id: 'gt', name: 'GT', performanceOffsetMs: 11000, fuelCapacityKg: 90 },
];

/** Six hours, three drivers to a car, refuelling allowed. */
export const ENDURANCE: Regulations = {
  id: 'endurance',
  name: 'Endurance Championship',
  raceLength: { kind: 'duration', seconds: 6 * 3600 },
  classes: ENDURANCE_CLASSES,
  tyreRules: {
    // Endurance crews double- and triple-stint a set; no compound is mandated.
    mandatoryCompoundChange: false,
    allowedCompounds: ['soft', 'medium', 'hard', 'intermediate', 'wet'],
  },
  stints: { maxDriverStintSeconds: 4500, minDriverCount: 3 },
  overtaking: { drsZones: 0, classDifferentialBonusMs: 4000 },
  cautions: { kind: 'fullCourseYellow', incidentRatePerLap: 0.0018 },
  // Endurance cars are built to survive and driven with that in mind.
  attritionScale: 0.35,
  // Endurance qualifying is one session for everybody: the classes sort
  // themselves out on pace, and nobody is knocked out of their own race.
  qualifying: {
    format: 'single',
    slots: 10,
    segments: [{ name: 'Qualifying', survivors: Number.MAX_SAFE_INTEGER }],
  },
  refuelling: true,
};

export function enduranceOverHours(hours: number): Regulations {
  return { ...ENDURANCE, raceLength: { kind: 'duration', seconds: Math.round(hours * 3600) } };
}
