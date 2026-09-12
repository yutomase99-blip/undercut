/**
 * Core data model for the Undercut race engine.
 *
 * Every duration is in milliseconds and every rating is a 0..1 scalar, so that
 * balance numbers stay comparable across tracks, cars and drivers.
 */

export type CarId = string;
export type DriverId = string;
export type TeamId = string;
export type ClassId = string;
export type CompoundId = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';
export type WeatherState = 'dry' | 'damp' | 'wet';
export type PaceMode = 'push' | 'hold' | 'save';
export type RetirementCause = 'mechanical' | 'collision' | 'driverError' | 'outOfFuel';

/** A tyre compound's performance envelope. */
export interface Compound {
  id: CompoundId;
  label: string;
  /** Peak pace relative to the reference lap. Negative is faster. */
  baseOffsetMs: number;
  /** Laps needed to reach peak grip. */
  warmupLaps: number;
  /** Time lost per lap of age before the cliff. */
  degPerLapMs: number;
  /** Age at which degradation accelerates sharply. */
  cliffLap: number;
  /** Degradation multiplier once past the cliff. */
  cliffFactor: number;
  /** Time penalty for running this compound in each weather state. */
  weatherPenaltyMs: Record<WeatherState, number>;
}

/** A point on the circuit map, in arbitrary layout units. */
export interface LayoutPoint {
  x: number;
  y: number;
}

export interface Track {
  id: string;
  name: string;
  country: string;
  /** Reference lap for a perfect car on fresh softs with no fuel. */
  baseLapMs: number;
  /** Time lost driving through the pit lane, excluding the stop itself. */
  pitLaneLossMs: number;
  /** 0 = passing is trivial, 1 = passing is near impossible. */
  overtakingDifficulty: number;
  /** Scales tyre degradation. 1 is neutral. */
  tyreWearFactor: number;
  fuelPerLapKg: number;
  /** 0 = stable, 1 = wildly changeable. */
  weatherVolatility: number;
  defaultLaps: number;
  /** Closed loop describing the circuit for the map view. */
  layout: LayoutPoint[];
}

export interface Driver {
  id: DriverId;
  name: string;
  /** Raw pace. 1 is the theoretical best on the grid. */
  skill: number;
  /** Resistance to lap-time scatter and mistakes. */
  consistency: number;
  /** Willingness to commit to a move. */
  aggression: number;
}

export interface Team {
  id: TeamId;
  name: string;
  colour: string;
  /** Car pace. 1 is the theoretical best on the grid. */
  carPerformance: number;
  pitCrewSkill: number;
  /** 1 is bulletproof. */
  reliability: number;
}

/** A performance bracket. Open-wheel racing has one; endurance has several. */
export interface CarClass {
  id: ClassId;
  name: string;
  /** Time added to the reference lap for this class. */
  performanceOffsetMs: number;
  /** Tank size. Only meaningful where the regulations allow refuelling. */
  fuelCapacityKg?: number;
}

export interface Entry {
  carId: CarId;
  teamId: TeamId;
  /** The driver who starts the race. */
  driverId: DriverId;
  /** The full crew, in the order they take over. Defaults to the starter alone. */
  driverIds?: DriverId[];
  classId: ClassId;
  startingCompound: CompoundId;
}

export interface LapBreakdown {
  baseMs: number;
  classMs: number;
  carMs: number;
  driverMs: number;
  tyreMs: number;
  fuelMs: number;
  trafficMs: number;
  paceMs: number;
  /** Track surface state: negative once rubber has gone down. */
  surfaceMs: number;
  errorMs: number;
  totalMs: number;
}

export interface CarState {
  id: CarId;
  teamId: TeamId;
  driverId: DriverId;
  classId: ClassId;
  position: number;
  lapsCompleted: number;
  raceTimeMs: number;
  lastLapMs: number;
  bestLapMs: number;
  compound: CompoundId;
  tyreAgeLaps: number;
  /** 100 = fresh, 0 = destroyed. Display only; the model uses age. */
  tyreConditionPct: number;
  fuelKg: number;
  paceMode: PaceMode;
  pitStops: number;
  compoundsUsed: CompoundId[];
  retired: boolean;
  retiredCause: RetirementCause | null;
  gapToLeaderMs: number;
  gapAheadMs: number;
  lastBreakdown: LapBreakdown | null;
  /** Position within this car's class. Always 1..n, per class. */
  classPosition: number;
  /** Seconds the driver currently aboard has been at the wheel. */
  stintSeconds: number;
  /** Everyone who has driven this car so far, in order. */
  driversUsed: DriverId[];
  /** True once this car has taken the flag. */
  finished: boolean;
}

export type CautionPhase = 'none' | 'deployed' | 'ending';

export interface RaceState {
  lap: number;
  totalLaps: number;
  /** Race time elapsed at the front of the field. */
  elapsedMs: number;
  /** Set for a race limited by the clock rather than by a lap count. */
  durationMs: number | null;
  weather: WeatherState;
  caution: CautionPhase;
  cautionLapsRemaining: number;
  cars: CarState[];
  finished: boolean;
}

export type Command =
  | { type: 'pit'; car: CarId; compound: CompoundId; driverChange?: DriverId }
  | { type: 'pace'; car: CarId; mode: PaceMode };

export type RaceEvent =
  | { lap: number; type: 'raceStart'; weather: WeatherState }
  | { lap: number; type: 'lapCompleted'; car: CarId; lapTimeMs: number; position: number }
  | { lap: number; type: 'overtake'; car: CarId; victim: CarId; success: boolean }
  | { lap: number; type: 'pitStop'; car: CarId; compound: CompoundId; stationaryMs: number }
  | { lap: number; type: 'caution'; phase: 'deployed' | 'ending' }
  | { lap: number; type: 'weather'; from: WeatherState; to: WeatherState }
  | { lap: number; type: 'retirement'; car: CarId; cause: RetirementCause }
  | { lap: number; type: 'driverChange'; car: CarId; from: DriverId; to: DriverId }
  | { lap: number; type: 'radio'; car: CarId; message: string }
  | { lap: number; type: 'chequeredFlag'; winner: CarId };

export interface Classification {
  position: number;
  carId: CarId;
  teamId: TeamId;
  driverId: DriverId;
  classId: ClassId;
  lapsCompleted: number;
  raceTimeMs: number;
  classPosition: number;
  gapToWinnerMs: number;
  bestLapMs: number;
  pitStops: number;
  penaltyMs: number;
  retired: boolean;
  retiredCause: RetirementCause | null;
}

export interface RaceResult {
  trackId: string;
  seed: string;
  totalLaps: number;
  classification: Classification[];
  events: RaceEvent[];
}

/** Time added to a car's race for breaking a regulation, such as never changing compound. */
export interface Penalty {
  carId: CarId;
  reason: string;
  timeMs: number;
}

import type { Regulations } from './rules/regulations.ts';

export interface RaceConfig {
  track: Track;
  regulations: Regulations;
  entries: Entry[];
  startingWeather: WeatherState;
  /** The car the player calls strategy for. AI handles every other car. */
  playerCarId?: CarId | null;
  /**
   * Team and driver stats to use for this race instead of the registered
   * content.
   *
   * A championship develops cars between rounds, so the same team is a
   * different machine in August than it was in March. Passing the roster in
   * keeps that a property of the race being run rather than a mutation of
   * shared content, which would leak between races.
   */
  roster?: { teams?: Team[]; drivers?: Driver[] };
  /**
   * The grid, in order, as set by qualifying. Without it the engine falls back
   * to a single abstracted qualifying lap per car.
   */
  startingGrid?: CarId[];
}
