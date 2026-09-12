import type { WeatherState } from '../types.ts';
import type { Rng } from '../rng/streams.ts';

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
