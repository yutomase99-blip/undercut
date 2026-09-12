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
  /**
   * Sets of each compound a car has for the whole weekend.
   *
   * Qualifying and the race draw from the same pot, which is what gives a
   * qualifying run a price: a lap on softs for grid position is a set you no
   * longer have on Sunday.
   */
  tyreAllocation: Record<CompoundId, number>;
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
  /**
   * How the grid is decided.
   *
   * A knockout eliminates down to the survivors named by each segment; a
   * single session runs everybody once and sorts them. `slots` is how many
   * windows a session is divided into — running late means a rubbered-in track
   * but a busier one.
   */
  qualifying: {
    format: 'knockout' | 'single';
    slots: number;
    segments: { name: string; survivors: number }[];
  };
  refuelling: boolean;
}
