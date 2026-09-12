import { describe, expect, it } from 'vitest';
import { rollStartingWeather } from '../src/core/weather.ts';
import { createRace, simulate } from '../src/core/race.ts';
import { runQualifying } from '../src/core/qualifying.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { trackById, TRACKS } from '../src/content/tracks.ts';
import { openWheelOverLaps } from '../src/rules/openwheel.ts';
import type { RaceConfig, WeatherState } from '../src/types.ts';

const changeable = trackById('monte-cielo');
const stable = trackById('sable-dunes');

function config(track = changeable, laps = 20): Omit<RaceConfig, 'startingWeather'> {
  return { track, regulations: openWheelOverLaps(laps), entries: defaultGrid() };
}

function spread(track: typeof changeable, samples = 600): Record<WeatherState, number> {
  const counts: Record<WeatherState, number> = { dry: 0, damp: 0, wet: 0 };
  for (let i = 0; i < samples; i += 1) counts[rollStartingWeather(track, `roll-${i}`)] += 1;
  return counts;
}

describe('conditions at the start', () => {
  it('is the same for a seed and a circuit, every time', () => {
    for (const track of TRACKS) {
      expect(rollStartingWeather(track, 'fixed')).toBe(rollStartingWeather(track, 'fixed'));
    }
  });

  it('differs between circuits on the same seed', () => {
    const states = new Set(TRACKS.map((track) => rollStartingWeather(track, 'shared-seed')));
    expect(states.size).toBeGreaterThan(0);
  });

  it('is usually dry', () => {
    expect(spread(changeable).dry / 600).toBeGreaterThan(0.7);
  });

  it('rains more often somewhere changeable than somewhere stable', () => {
    const wetness = (track: typeof changeable) => {
      const counts = spread(track);
      return (counts.damp + counts.wet) / 600;
    };
    expect(wetness(changeable)).toBeGreaterThan(wetness(stable));
  });

  it('does sometimes start a race in the rain', () => {
    const counts = spread(changeable);
    expect(counts.damp + counts.wet).toBeGreaterThan(0);
  });
});

describe('a race left to decide for itself', () => {
  it('rolls its own conditions when none are given', () => {
    const race = createRace(config(), 'decide-1');
    expect(['dry', 'damp', 'wet']).toContain(race.state().weather);
  });

  it('uses the conditions it is given when it is told', () => {
    const race = createRace({ ...config(), startingWeather: 'wet' }, 'decide-2');
    expect(race.state().weather).toBe('wet');
  });

  it('agrees with qualifying about what the weather was', () => {
    // Both sessions have to reach the same conclusion, or a car qualifies on
    // wets for a race that starts dry.
    for (const seed of ['weekend-a', 'weekend-b', 'weekend-c']) {
      const qualifying = runQualifying(config(), seed);
      const race = createRace(config(), seed);
      const qualifyingCompounds = new Set(qualifying.laps.map((l) => l.compound));
      const dryRace = race.state().weather === 'dry';
      const ranDryTyres = [...qualifyingCompounds].some((c) =>
        ['soft', 'medium', 'hard'].includes(c),
      );
      expect(ranDryTyres).toBe(dryRace);
    }
  });

  it('still replays identically', () => {
    const a = simulate(config(), 'decide-determinism');
    const b = simulate(config(), 'decide-determinism');
    expect(a.classification).toEqual(b.classification);
  });

  it('runs a full field home whatever it decides', () => {
    for (let i = 0; i < 8; i += 1) {
      const result = simulate(config(changeable, 25), `decide-field-${i}`);
      expect(result.classification).toHaveLength(defaultGrid().length);
      expect(result.classification.filter((c) => !c.retired).length).toBeGreaterThan(10);
    }
  });
});

describe('nobody starts a wet race on slicks', () => {
  it('fits the field for the conditions, whatever the entry says', () => {
    // The default grid enters everyone on mediums. In the wet that is not a
    // strategy, it is a mistake nobody chose.
    const race = createRace({ ...config(), startingWeather: 'wet' }, 'wet-start');
    for (const car of race.state().cars) {
      expect(['intermediate', 'wet']).toContain(car.compound);
    }
  });

  it('leaves a sensible entry alone in the dry', () => {
    const race = createRace({ ...config(), startingWeather: 'dry' }, 'dry-start');
    for (const car of race.state().cars) {
      expect(car.compound).toBe('medium');
    }
  });

  it('fits intermediates when the track is merely damp', () => {
    const race = createRace({ ...config(), startingWeather: 'damp' }, 'damp-start');
    for (const car of race.state().cars) {
      expect(car.compound).toBe('intermediate');
    }
  });

  it('takes a set out of the garage to start the race on', () => {
    const race = createRace({ ...config(), startingWeather: 'dry' }, 'start-set');
    const carId = defaultGrid()[0]!.carId;
    // Three mediums in the allocation, one of them now bolted to the car.
    expect(race.allocationOf(carId).medium).toBe(2);
  });
});
