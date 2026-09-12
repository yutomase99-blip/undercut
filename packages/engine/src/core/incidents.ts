import type { Driver, PaceMode, RetirementCause, Team, WeatherState } from '../types.ts';
import type { Rng } from '../rng/streams.ts';

const MECHANICAL_BASE = 0.004;
const DRIVER_ERROR_BASE = 0.0025;

const WEATHER_RISK: Record<WeatherState, number> = { dry: 1, damp: 1.6, wet: 2.3 };
const PACE_RISK: Record<PaceMode, number> = { push: 1.5, hold: 1, save: 0.75 };

/**
 * One roll per running car per lap. Reliability and consistency are the dials:
 * a bulletproof car with a metronomic driver almost always sees the flag.
 */
export function rollRetirement(
  team: Team,
  driver: Driver,
  weather: WeatherState,
  paceMode: PaceMode,
  mechanicalRng: Rng,
  driverRng: Rng,
): RetirementCause | null {
  const mechanical = (1 - team.reliability) * MECHANICAL_BASE;
  if (mechanicalRng.chance(mechanical)) return 'mechanical';

  const error =
    (1 - driver.consistency) * DRIVER_ERROR_BASE * WEATHER_RISK[weather] * PACE_RISK[paceMode];
  if (driverRng.chance(error)) return 'driverError';

  return null;
}

/** Whether an incident brings out a caution rather than being cleared quietly. */
export function cautionFollows(incidentRatePerLap: number, rng: Rng): boolean {
  return rng.chance(Math.min(0.75, 0.35 + incidentRatePerLap * 40));
}
