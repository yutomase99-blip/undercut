import { describe, expect, it } from 'vitest';
import {
  forecastAccuracy,
  forecastFrom,
  forecastTrustFor,
  rollWeatherTimeline,
} from '../src/core/weather.ts';
import { decideStrategy, type StrategyView } from '../src/ai/strategist.ts';
import { createStreams } from '../src/rng/streams.ts';
import { createRace, simulate } from '../src/core/race.ts';
import { defaultGrid, TEAMS, teamById } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { openWheelOverLaps, OPEN_WHEEL } from '../src/rules/openwheel.ts';
import { hashEvents } from '../src/replay/hash.ts';
import type { RaceConfig, WeatherState } from '../src/types.ts';

const track = trackById('monte-cielo');

function timeline(seed: string, laps = 60): WeatherState[] {
  return rollWeatherTimeline('dry', laps, 0.9, createStreams(seed).weather);
}

function view(overrides: Partial<StrategyView> = {}): StrategyView {
  return {
    lap: 10,
    compound: 'medium',
    tyreAgeLaps: 5,
    tyreConditionPct: 80,
    pitStops: 1,
    compoundsUsed: ['medium', 'soft'],
    gapAheadMs: 2000,
    lapsRemaining: 25,
    plannedStintLaps: 22,
    weather: 'dry',
    lapsSinceWeatherChange: 20,
    reactionLaps: 1,
    cautionDeployed: false,
    wearFactor: 1,
    fuelKg: 60,
    fuelPerLapKg: 1.8,
    stintSeconds: 900,
    maxStintSeconds: null,
    forecast: [],
    forecastLookahead: 2,
    forecastTrust: 0.6,
    regulations: OPEN_WHEEL,
    rng: createStreams('view').strategy,
    ...overrides,
  };
}

describe('a team’s own forecast', () => {
  it('is not the same as another team’s', () => {
    const rolled = timeline('teams-differ');
    const a = forecastFrom(rolled, 10, 'seed:meridian');
    const b = forecastFrom(rolled, 10, 'seed:corvid');
    expect(a.map((e) => e.state)).not.toEqual(b.map((e) => e.state));
  });

  it('is better at a better-run team', () => {
    const strong = forecastAccuracy(teamById('meridian'));
    const weak = forecastAccuracy(teamById('corvid'));
    expect(strong).toBeGreaterThan(weak);
  });

  it('is wrong less often when the team is better at it', () => {
    const wrongness = (accuracy: number) => {
      let wrong = 0;
      let total = 0;
      for (let i = 0; i < 80; i += 1) {
        const seed = `acc-${i}`;
        const rolled = timeline(seed);
        for (let lap = 0; lap < 40; lap += 4) {
          const entries = forecastFrom(rolled, lap, seed, 6, accuracy);
          for (const entry of entries) {
            total += 1;
            if (entry.state !== rolled[entry.lap]) wrong += 1;
          }
        }
      }
      return wrong / total;
    };
    expect(wrongness(1.15)).toBeLessThan(wrongness(0.85));
  });

  it('makes a better-run team commit sooner than a nervous one', () => {
    // A lower threshold is reached earlier, because confidence in a change
    // climbs as it approaches.
    expect(forecastTrustFor(teamById('meridian'))).toBeLessThan(
      forecastTrustFor(teamById('corvid')),
    );
  });

  it('never reports more confidence than certainty', () => {
    const rolled = timeline('cap');
    for (const entry of forecastFrom(rolled, 5, 'cap', 6, 2)) {
      expect(entry.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('acting on the forecast', () => {
  it('boxes ahead of rain it is confident about', () => {
    const decision = decideStrategy(
      view({
        forecast: [{ lap: 11, state: 'wet', confidence: 0.95 }],
        forecastLookahead: 2,
      }),
    );
    expect(decision.pitCompound).toBe('wet');
  });

  it('fits for the weather that is coming, not the one outside now', () => {
    const decision = decideStrategy(
      view({
        weather: 'dry',
        forecast: [{ lap: 12, state: 'damp', confidence: 0.9 }],
        forecastLookahead: 2,
      }),
    );
    expect(decision.pitCompound).toBe('intermediate');
  });

  it('ignores a call it is not confident about', () => {
    const decision = decideStrategy(
      view({ forecast: [{ lap: 11, state: 'wet', confidence: 0.3 }], forecastLookahead: 2 }),
    );
    expect(decision.pitCompound).toBeNull();
  });

  it('ignores rain that is further off than it looks ahead', () => {
    const decision = decideStrategy(
      view({ forecast: [{ lap: 16, state: 'wet', confidence: 0.95 }], forecastLookahead: 2 }),
    );
    expect(decision.pitCompound).toBeNull();
  });

  it('does not anticipate at all when the team cannot read a forecast', () => {
    const decision = decideStrategy(
      view({ forecast: [{ lap: 11, state: 'wet', confidence: 0.99 }], forecastLookahead: 0 }),
    );
    expect(decision.pitCompound).toBeNull();
  });

  it('still reacts once the weather has actually turned', () => {
    const decision = decideStrategy(
      view({ weather: 'wet', compound: 'medium', forecast: [], forecastLookahead: 0 }),
    );
    expect(decision.pitCompound).toBe('wet');
  });
});

describe('in a race', () => {
  function config(laps = 45): RaceConfig {
    return {
      track,
      regulations: openWheelOverLaps(laps),
      entries: defaultGrid(),
      startingWeather: 'dry',
    };
  }

  it('gives each team its own forecast rather than one for everybody', () => {
    const race = createRace(config(), 'race-own-forecast');
    const a = race.forecastFor('meridian');
    const b = race.forecastFor('corvid');
    expect(a.map((e) => `${e.state}${Math.round(e.confidence * 100)}`)).not.toEqual(
      b.map((e) => `${e.state}${Math.round(e.confidence * 100)}`),
    );
  });

  it('does not send the whole field into the pits on one lap', () => {
    // The failure the reaction delay was added to stop, now that every pit
    // wall can see the same weather coming.
    let worst = 0;
    for (let i = 0; i < 12; i += 1) {
      const result = simulate(config(), `stagger-${i}`);
      const perLap = new Map<number, number>();
      for (const event of result.events) {
        if (event.type === 'pitStop') perLap.set(event.lap, (perLap.get(event.lap) ?? 0) + 1);
      }
      worst = Math.max(worst, ...perLap.values());
    }
    expect(worst).toBeLessThan(TEAMS.length * 2 * 0.7);
  });

  it('still replays a seed identically', () => {
    const a = simulate(config(), 'forecast-determinism');
    const b = simulate(config(), 'forecast-determinism');
    expect(hashEvents(a.events)).toBe(hashEvents(b.events));
  });

  it('leaves the field finishing races', () => {
    const result = simulate(config(), 'forecast-sanity');
    const finishers = result.classification.filter((c) => !c.retired);
    expect(finishers.length).toBeGreaterThan(12);
  });
});
