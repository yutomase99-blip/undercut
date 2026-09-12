import type {
  CarClass,
  Compound,
  Driver,
  LapBreakdown,
  PaceMode,
  Team,
  Track,
  WeatherState,
} from '../types.ts';
import type { Rng } from '../rng/streams.ts';
import { tyreDeltaMs } from './tyres.ts';

/** Time cost of a kilogram of fuel over one lap. */
export const FUEL_MS_PER_KG = 30;
/** Gap between the best and worst driver on the grid, on pace alone. */
export const DRIVER_SPREAD_MS = 1100;
/** Gap between the best and worst car on the grid. */
export const CAR_SPREAD_MS = 2100;
/** Lap-time effect of how hard the driver is being asked to go. */
export const PACE_DELTA_MS: Record<PaceMode, number> = { push: -320, hold: 0, save: 520 };
/** Scatter of an utterly inconsistent driver. Scaled by driver consistency. */
export const ERROR_SIGMA_MS = 420;
/**
 * Even a metronome varies. Without this floor the field is so repeatable that
 * the fastest car wins essentially every race, which is neither realistic nor
 * fun to play against.
 */
export const ERROR_SIGMA_FLOOR = 0.34;

export interface LapTimeInput {
  track: Track;
  team: Team;
  driver: Driver;
  carClass: CarClass;
  compound: Compound;
  tyreAgeLaps: number;
  fuelKg: number;
  paceMode: PaceMode;
  weather: WeatherState;
  /** Time lost behind another car this lap, decided by the race loop. */
  trafficMs: number;
  /**
   * State of the track surface, negative as rubber goes down. Qualifying uses
   * it for evolution across a session; a race leaves it at zero.
   */
  surfaceMs?: number;
  rng: Rng;
}

/**
 * Every term is additive and individually inspectable, so the UI can tell the
 * player exactly where a lap went. A multiplicative model looks plausible and
 * is impossible to tune: when a car is a second off, nothing says which factor
 * caused it.
 */
export function computeLapTime(input: LapTimeInput): LapBreakdown {
  const baseMs = input.track.baseLapMs;
  const classMs = input.carClass.performanceOffsetMs;
  const carMs = (1 - input.team.carPerformance) * CAR_SPREAD_MS;
  const driverMs = (1 - input.driver.skill) * DRIVER_SPREAD_MS;
  const tyreMs = tyreDeltaMs(
    input.compound,
    input.tyreAgeLaps,
    input.weather,
    input.track.tyreWearFactor,
  );
  const fuelMs = input.fuelKg * FUEL_MS_PER_KG;
  const trafficMs = input.trafficMs;
  const paceMs = PACE_DELTA_MS[input.paceMode];
  const surfaceMs = input.surfaceMs ?? 0;

  // A mistake costs time; a exceptional lap saves a little. The floor keeps
  // the distribution honest — nobody finds two seconds out of nowhere.
  const sigma = (ERROR_SIGMA_FLOOR + (1 - input.driver.consistency)) * ERROR_SIGMA_MS;
  const errorMs = Math.max(-150, input.rng.normal(0, sigma));

  const totalMs =
    baseMs + classMs + carMs + driverMs + tyreMs + fuelMs + trafficMs + paceMs + surfaceMs + errorMs;

  return {
    baseMs,
    classMs,
    carMs,
    driverMs,
    tyreMs,
    fuelMs,
    trafficMs,
    paceMs,
    surfaceMs,
    errorMs,
    totalMs,
  };
}

/** How much faster the tyre wears in each pace mode. */
export const PACE_WEAR_FACTOR: Record<PaceMode, number> = { push: 1.45, hold: 1, save: 0.72 };
/** How much more fuel each pace mode burns. */
export const PACE_FUEL_FACTOR: Record<PaceMode, number> = { push: 1.12, hold: 1, save: 0.88 };
