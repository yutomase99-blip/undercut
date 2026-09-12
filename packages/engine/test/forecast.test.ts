import { describe, expect, it } from 'vitest';
import {
  FORECAST_HORIZON,
  confidenceAt,
  forecastFrom,
  rollWeatherTimeline,
} from '../src/core/weather.ts';
import { createStreams, sampleAt } from '../src/rng/streams.ts';
import { createRace } from '../src/core/race.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig, WeatherState } from '../src/types.ts';

const track = trackById('monte-cielo');

function timeline(seed: string, laps = 50, volatility = track.weatherVolatility): WeatherState[] {
  return rollWeatherTimeline('dry', laps, volatility, createStreams(seed).weather);
}

describe('the weather timeline', () => {
  it('covers every lap of the race and starts where the race starts', () => {
    const rolled = timeline('t-1', 40);
    expect(rolled).toHaveLength(40);
    expect(rolled[0]).toBe('dry');
  });

  it('is the same for the same seed and different for another', () => {
    expect(timeline('t-2')).toEqual(timeline('t-2'));
    expect(timeline('t-2')).not.toEqual(timeline('t-3'));
  });

  it('never jumps from dry straight to a downpour', () => {
    const ladder: WeatherState[] = ['dry', 'damp', 'wet'];
    for (let i = 0; i < 40; i += 1) {
      const rolled = timeline(`t-ladder-${i}`, 60, 1);
      for (let lap = 1; lap < rolled.length; lap += 1) {
        const step = Math.abs(ladder.indexOf(rolled[lap]!) - ladder.indexOf(rolled[lap - 1]!));
        expect(step).toBeLessThanOrEqual(1);
      }
    }
  });

  it('changes more often on a volatile circuit', () => {
    const changes = (volatility: number) => {
      let total = 0;
      for (let i = 0; i < 30; i += 1) {
        const rolled = timeline(`t-vol-${i}`, 60, volatility);
        total += rolled.filter((state, lap) => lap > 0 && state !== rolled[lap - 1]).length;
      }
      return total;
    };
    expect(changes(0.9)).toBeGreaterThan(changes(0.1));
  });
});

describe('the forecast', () => {
  const rolled = timeline('f-1', 50);

  it('looks ahead as far as the horizon, and no further than the race', () => {
    expect(forecastFrom(rolled, 10, 'f-1')).toHaveLength(FORECAST_HORIZON);
    expect(forecastFrom(rolled, 48, 'f-1').length).toBeLessThanOrEqual(2);
    expect(forecastFrom(rolled, 50, 'f-1')).toHaveLength(0);
  });

  it('is less sure the further out it looks', () => {
    const entries = forecastFrom(rolled, 5, 'f-1');
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i]!.confidence).toBeLessThan(entries[i - 1]!.confidence);
    }
  });

  it('is certain about the lap it is standing on', () => {
    for (let lap = 0; lap < 40; lap += 1) {
      const next = forecastFrom(rolled, lap, 'f-1')[0]!;
      expect(next.state).toBe(rolled[lap + 1] ?? rolled[lap]);
      expect(next.confidence).toBeGreaterThan(0.9);
    }
  });

  it('converges: once it has a lap right it does not change its mind', () => {
    // The same future lap, seen from further and further away.
    for (const targetLap of [20, 25, 30]) {
      let firstCorrectAt: number | null = null;
      for (let distance = FORECAST_HORIZON; distance >= 1; distance -= 1) {
        const from = targetLap - distance;
        if (from < 0) continue;
        const entry = forecastFrom(rolled, from, 'f-1').find((e) => e.lap === targetLap);
        if (!entry) continue;
        const correct = entry.state === rolled[targetLap];
        if (correct && firstCorrectAt === null) firstCorrectAt = distance;
        if (firstCorrectAt !== null) expect(correct).toBe(true);
      }
    }
  });

  it('is wrong often enough at long range to be worth doubting', () => {
    let wrong = 0;
    let total = 0;
    for (let i = 0; i < 60; i += 1) {
      const seed = `f-wrong-${i}`;
      const rolledSeed = timeline(seed, 60, 0.9);
      for (let lap = 0; lap < 40; lap += 5) {
        const entries = forecastFrom(rolledSeed, lap, seed);
        const far = entries[entries.length - 1];
        if (!far) continue;
        total += 1;
        if (far.state !== rolledSeed[far.lap]) wrong += 1;
      }
    }
    expect(wrong / total).toBeGreaterThan(0.02);
    expect(wrong / total).toBeLessThan(0.5);
  });

  it('gives the same forecast for the same seed', () => {
    expect(forecastFrom(rolled, 12, 'f-1')).toEqual(forecastFrom(rolled, 12, 'f-1'));
  });
});

describe('indexed sampling', () => {
  it('is stable for the same key and different for another', () => {
    expect(sampleAt('seed', 'forecast', 12)).toBe(sampleAt('seed', 'forecast', 12));
    expect(sampleAt('seed', 'forecast', 12)).not.toBe(sampleAt('seed', 'forecast', 13));
    expect(sampleAt('other', 'forecast', 12)).not.toBe(sampleAt('seed', 'forecast', 12));
  });

  it('stays inside the unit interval', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = sampleAt('bounds', i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('confidence', () => {
  it('falls off with distance but never to nothing', () => {
    expect(confidenceAt(1)).toBeGreaterThan(confidenceAt(5));
    expect(confidenceAt(FORECAST_HORIZON)).toBeGreaterThan(0);
    expect(confidenceAt(1)).toBeLessThanOrEqual(1);
  });
});

describe('the race publishes a forecast', () => {
  function config(laps = 40): RaceConfig {
    return {
      track,
      regulations: openWheelOverLaps(laps),
      entries: defaultGrid(),
      startingWeather: 'dry',
    };
  }

  it('offers one from the pit wall as the race runs', () => {
    const race = createRace(config(), 'race-forecast');
    const opening = race.forecast();
    expect(opening.length).toBeGreaterThan(0);
    expect(opening[0]!.lap).toBe(1);

    race.tick();
    race.tick();
    expect(race.forecast()[0]!.lap).toBe(3);
  });

  it('matches what the race then actually does', () => {
    const race = createRace(config(), 'race-forecast-truth');
    const predictedNext = race.forecast()[0]!;
    race.tick();
    expect(race.state().weather).toBe(predictedNext.state);
  });

  it('runs out of forecast at the end of the race', () => {
    const race = createRace(config(10), 'race-forecast-end');
    while (!race.isFinished()) race.tick();
    expect(race.forecast()).toHaveLength(0);
  });
});
