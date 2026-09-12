import type { WeatherState } from '../types.ts';
import { sampleAt, type Rng } from '../rng/streams.ts';

const LADDER: WeatherState[] = ['dry', 'damp', 'wet'];

/**
 * Weather moves one rung at a time, never from dry to a downpour in a lap.
 * A volatile circuit simply rolls the dice more often.
 */
export function stepWeather(current: WeatherState, volatility: number, rng: Rng): WeatherState {
  const changeChance = volatility * 0.05;
  if (!rng.chance(changeChance)) return current;

  const index = LADDER.indexOf(current);
  const direction = rng.chance(0.5) ? -1 : 1;
  const next = LADDER[Math.max(0, Math.min(LADDER.length - 1, index + direction))];
  return next ?? current;
}

/** Compounds that make sense in each weather state, best first. */
export function suitableCompounds(weather: WeatherState): ('soft' | 'medium' | 'hard' | 'intermediate' | 'wet')[] {
  switch (weather) {
    case 'dry':
      return ['soft', 'medium', 'hard'];
    case 'damp':
      return ['intermediate'];
    case 'wet':
      return ['wet', 'intermediate'];
  }
}

/** How many laps ahead the pit wall is given. */
export const FORECAST_HORIZON = 6;

export interface ForecastEntry {
  lap: number;
  state: WeatherState;
  /** How sure the forecast is, 0 to 1. Falls off with distance. */
  confidence: number;
}

/**
 * The weather for the whole race, decided up front.
 *
 * Rolling it in advance is what makes a forecast possible at all: there is a
 * real future to be more or less right about, rather than a coin waiting to be
 * flipped.
 */
export function rollWeatherTimeline(
  startingWeather: WeatherState,
  laps: number,
  volatility: number,
  rng: Rng,
): WeatherState[] {
  const timeline: WeatherState[] = [startingWeather];
  for (let lap = 1; lap < laps; lap += 1) {
    timeline.push(stepWeather(timeline[lap - 1]!, volatility, rng));
  }
  return timeline;
}

/** Confidence in a call this many laps out. Never certain, never worthless. */
export function confidenceAt(lapsAhead: number): number {
  return Math.max(0.35, Math.min(1, 0.99 - (lapsAhead - 1) * 0.11));
}

function nudge(state: WeatherState, direction: number): WeatherState {
  const index = LADDER.indexOf(state);
  const moved = Math.max(0, Math.min(LADDER.length - 1, index + (direction < 0.5 ? -1 : 1)));
  return LADDER[moved] ?? state;
}

/**
 * What the pit wall believes is coming.
 *
 * Each future lap carries one fixed measure of doubt. Confidence rises as that
 * lap approaches, so once it overtakes the doubt the forecast settles on the
 * truth and stays there — it converges rather than flickering, which is what
 * makes it worth acting on.
 */
export function forecastFrom(
  timeline: readonly WeatherState[],
  currentLap: number,
  seed: string,
  horizon = FORECAST_HORIZON,
  accuracy = 1,
): ForecastEntry[] {
  const entries: ForecastEntry[] = [];
  for (let ahead = 1; ahead <= horizon; ahead += 1) {
    const lap = currentLap + ahead;
    const truth = timeline[lap];
    if (truth === undefined) break;
    const confidence = Math.min(1, confidenceAt(ahead) * accuracy);
    const doubt = sampleAt(seed, 'forecast', lap);
    const state = doubt > confidence ? nudge(truth, sampleAt(seed, 'forecast-direction', lap)) : truth;
    entries.push({ lap, state, confidence });
  }
  return entries;
}

/**
 * How good a team is at reading the weather.
 *
 * Taken from pit-crew skill, which already stands for how well a team is run on
 * a Sunday rather than how quick its car is. A well-drilled operation has a
 * better meteorologist too.
 */
export function forecastAccuracy(team: { pitCrewSkill: number }): number {
  const quality = Math.max(0, Math.min(1, (team.pitCrewSkill - 0.65) / 0.3));
  return 0.8 + 0.35 * quality;
}

/**
 * How many laps ahead a team will actually commit to a call.
 *
 * The value of a forecast is a lap or two of anticipation, not six: fitting wet
 * tyres five laps before the rain arrives loses far more than it saves. The
 * best-run teams move a lap or two early; the worst wait until it is raining.
 */
export function forecastLookaheadFor(team: { pitCrewSkill: number }): number {
  const quality = Math.max(0, Math.min(1, (team.pitCrewSkill - 0.65) / 0.3));
  return 1 + Math.round(quality * 2);
}

/**
 * How sure a team insists on being before it acts.
 *
 * This is what staggers the field. Confidence in a given change climbs as it
 * approaches, so a team that commits at 60% moves several laps before one that
 * waits for 85% — and the nervous end of the grid never commits early at all,
 * and is left reacting to rain that is already falling.
 *
 * Without a personal threshold every pit wall reaches the same conclusion on
 * the same lap, and eighteen of twenty cars arrive in the pit lane together.
 */
export function forecastTrustFor(team: { pitCrewSkill: number }): number {
  const quality = Math.max(0, Math.min(1, (team.pitCrewSkill - 0.65) / 0.3));
  return 0.9 - 0.3 * quality;
}
