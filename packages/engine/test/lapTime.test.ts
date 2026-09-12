import { describe, expect, it } from 'vitest';
import { COMPOUNDS } from '../src/content/compounds.ts';
import { TEAMS, DRIVERS } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { OPEN_WHEEL } from '../src/rules/openwheel.ts';
import { computeLapTime, FUEL_MS_PER_KG } from '../src/core/lapTime.ts';
import { createStreams } from '../src/rng/streams.ts';

const track = trackById('kestrel-park');
const bestTeam = TEAMS[0]!;
const worstTeam = TEAMS[TEAMS.length - 1]!;
const bestDriver = DRIVERS[0]!;
const worstDriver = DRIVERS[DRIVERS.length - 1]!;
const openClass = OPEN_WHEEL.classes[0]!;

function lap(overrides: Partial<Parameters<typeof computeLapTime>[0]> = {}) {
  const streams = createStreams('lap-fixture');
  return computeLapTime({
    track,
    team: bestTeam,
    driver: bestDriver,
    carClass: openClass,
    compound: COMPOUNDS.medium,
    tyreAgeLaps: 3,
    fuelKg: 20,
    paceMode: 'hold',
    weather: 'dry',
    trafficMs: 0,
    rng: streams.driverError,
    ...overrides,
  });
}

describe('lap time model', () => {
  it('sums its parts exactly', () => {
    const b = lap();
    const sum =
      b.baseMs + b.classMs + b.carMs + b.driverMs + b.tyreMs + b.fuelMs + b.trafficMs + b.paceMs + b.errorMs;
    expect(b.totalMs).toBeCloseTo(sum, 6);
  });

  it('costs time for fuel on board', () => {
    const light = lap({ fuelKg: 5 });
    const heavy = lap({ fuelKg: 100 });
    expect(heavy.fuelMs - light.fuelMs).toBeCloseTo(95 * FUEL_MS_PER_KG, 6);
    expect(heavy.totalMs).toBeGreaterThan(light.totalMs);
  });

  it('makes the better car faster, all else equal', () => {
    expect(lap({ team: bestTeam }).totalMs).toBeLessThan(lap({ team: worstTeam }).totalMs);
  });

  it('makes the better driver faster, all else equal', () => {
    expect(lap({ driver: bestDriver }).totalMs).toBeLessThan(lap({ driver: worstDriver }).totalMs);
  });

  it('is faster on a push lap and slower when saving', () => {
    const push = lap({ paceMode: 'push' });
    const hold = lap({ paceMode: 'hold' });
    const save = lap({ paceMode: 'save' });
    expect(push.totalMs).toBeLessThan(hold.totalMs);
    expect(save.totalMs).toBeGreaterThan(hold.totalMs);
  });

  it('adds the traffic loss it was given', () => {
    expect(lap({ trafficMs: 800 }).trafficMs).toBe(800);
  });

  it('scatters less for a consistent driver than an erratic one', () => {
    const spread = (driver: typeof bestDriver) => {
      const streams = createStreams('scatter');
      const times = Array.from({ length: 400 }, () =>
        computeLapTime({
          track,
          team: bestTeam,
          driver,
          carClass: openClass,
          compound: COMPOUNDS.medium,
          tyreAgeLaps: 3,
          fuelKg: 20,
          paceMode: 'hold',
          weather: 'dry',
          trafficMs: 0,
          rng: streams.driverError,
        }).errorMs,
      );
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      return Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length);
    };
    expect(spread(worstDriver)).toBeGreaterThan(spread(bestDriver));
  });

  it('never returns an absurd lap time', () => {
    const streams = createStreams('sanity');
    for (let i = 0; i < 2000; i += 1) {
      const b = computeLapTime({
        track,
        team: worstTeam,
        driver: worstDriver,
        carClass: openClass,
        compound: COMPOUNDS.soft,
        tyreAgeLaps: 40,
        fuelKg: 110,
        paceMode: 'push',
        weather: 'dry',
        trafficMs: 1500,
        rng: streams.driverError,
      });
      expect(b.totalMs).toBeGreaterThan(track.baseLapMs * 0.9);
      expect(b.totalMs).toBeLessThan(track.baseLapMs * 2.5);
    }
  });
});
