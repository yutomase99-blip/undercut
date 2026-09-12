import type { CarClass, CompoundId } from '../types.ts';

/**
 * The plug point that lets one engine run different racing worlds.
 *
 * Nothing in `core/` may branch on a series name. If a behaviour differs
 * between open-wheel and endurance racing, it is described here.
 */
export interface Regulations {
  id: string;
  name: string;
  raceLength:
    | { kind: 'laps'; laps: number }
    | { kind: 'duration'; seconds: number };
  classes: CarClass[];
  tyreRules: {
    mandatoryCompoundChange: boolean;
    allowedCompounds: CompoundId[];
  };
  stints: {
    /** null when a single driver may run the whole race. */
    maxDriverStintSeconds: number | null;
    minDriverCount: number;
  };
  overtaking: {
    drsZones: number;
    /** Time bonus when a faster class closes on a slower one. */
    classDifferentialBonusMs: number;
  };
  cautions: {
    kind: 'safetyCar' | 'fullCourseYellow';
    /** Probability per car per lap of an incident worth investigating. */
    incidentRatePerLap: number;
  };
  /**
   * How hard this category is on cars and drivers, against a sprint baseline
   * of 1. Retirement is rolled per lap, so without this dial a 200-lap
   * endurance race inherits three times a sprint's attrition and a quarter of
   * the field fails to finish.
   */
  attritionScale: number;
  refuelling: boolean;
}
