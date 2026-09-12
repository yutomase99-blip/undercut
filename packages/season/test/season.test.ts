import { describe, expect, it } from 'vitest';
import { TEAMS, TRACKS } from '@undercut/engine';
import {
  budgetFor,
  createSeason,
  driverStandings,
  developAi,
  isSeasonComplete,
  nextRound,
  raceConfigFor,
  recordResult,
  runRound,
  teamStandings,
  garageOptions,
  applyGarageOption,
} from '../src/season.ts';
import type { SeasonConfig } from '../src/types.ts';

const config: SeasonConfig = {
  championshipId: 'open-wheel',
  playerTeamId: 'kestros',
  trackIds: TRACKS.slice(0, 4).map((t) => t.id),
  raceLength: 20,
  seed: 'season-test',
};

describe('season shape', () => {
  it('starts before the first round with nobody scoring', () => {
    const season = createSeason(config);
    expect(season.round).toBe(0);
    expect(season.results).toHaveLength(0);
    expect(isSeasonComplete(season)).toBe(false);
    expect(driverStandings(season).every((s) => s.points === 0)).toBe(true);
  });

  it('carries every team into the season at its catalogue stats', () => {
    const season = createSeason(config);
    for (const team of TEAMS) {
      const development = season.teams.find((t) => t.teamId === team.id)!;
      // Built from parts now, so it reproduces the catalogue rather than
      // copying it.
      expect(development.carPerformance).toBeCloseTo(team.carPerformance, 2);
    }
  });

  it('runs a round and records it', () => {
    const season = recordResult(createSeason(config), runRound(createSeason(config)));
    expect(season.results).toHaveLength(1);
    expect(season.round).toBe(1);
    expect(season.results[0]!.trackId).toBe(config.trackIds[0]);
  });

  it('completes after the last round', () => {
    let season = createSeason(config);
    while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
    expect(season.results).toHaveLength(config.trackIds.length);
    expect(nextRound(season)).toBeNull();
  });

  it('gives every round its own seed, so rounds are not copies', () => {
    let season = createSeason(config);
    while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
    const seeds = season.results.map((r) => r.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('replays a season identically from the same seed', () => {
    const run = () => {
      let season = createSeason(config);
      while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
      return driverStandings(season).map((s) => `${s.driverId}:${s.points}`).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('standings', () => {
  it('ranks drivers by points, highest first', () => {
    let season = createSeason(config);
    while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
    const points = driverStandings(season).map((s) => s.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it('gives a team the sum of its drivers', () => {
    let season = createSeason(config);
    while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
    const drivers = driverStandings(season);
    for (const team of teamStandings(season)) {
      const fromDrivers = drivers
        .filter((d) => d.teamId === team.teamId)
        .reduce((sum, d) => sum + d.points, 0);
      expect(team.points).toBe(fromDrivers);
    }
  });

  it('awards points on every round it has run', () => {
    let season = createSeason(config);
    season = recordResult(season, runRound(season));
    const afterOne = driverStandings(season).reduce((sum, s) => sum + s.points, 0);
    season = recordResult(season, runRound(season));
    const afterTwo = driverStandings(season).reduce((sum, s) => sum + s.points, 0);
    expect(afterTwo).toBeGreaterThan(afterOne);
  });
});

describe('the garage', () => {
  it('gives the slower teams more to spend', () => {
    expect(budgetFor(0.66)).toBeGreaterThan(budgetFor(1.0));
  });

  it('offers something for every part, to improve and to rebuild', () => {
    const team = createSeason(config).teams.find((t) => t.teamId === 'kestros')!;
    const options = garageOptions(team);
    expect(options.filter((o) => o.action === 'upgrade')).toHaveLength(5);
    expect(options.filter((o) => o.action === 'repair')).toHaveLength(5);
  });

  it('marks what a team cannot afford', () => {
    const team = createSeason(config).teams.find((t) => t.teamId === 'kestros')!;
    expect(garageOptions({ ...team, budget: 0 }).every((o) => !o.affordable)).toBe(true);
  });

  it('does not suggest rebuilding a part that is brand new', () => {
    const team = createSeason(config).teams.find((t) => t.teamId === 'kestros')!;
    expect(garageOptions(team).filter((o) => o.action === 'repair' && o.worthwhile)).toHaveLength(0);
  });

  it('spends budget and makes the car quicker', () => {
    const team = createSeason(config).teams.find((t) => t.teamId === 'kestros')!;
    const option = garageOptions(team).find((o) => o.id === 'engine-upgrade')!;
    const after = applyGarageOption(team, option);
    expect(after.budget).toBe(team.budget - option.cost);
    expect(after.carPerformance).toBeGreaterThan(team.carPerformance);
  });

  it('rebuilds condition without touching quality', () => {
    let season = createSeason(config);
    season = recordResult(season, runRound(season));
    const team = season.teams.find((t) => t.teamId === 'kestros')!;
    const option = garageOptions(team).find((o) => o.id === 'gearbox-repair')!;
    const after = applyGarageOption(team, option);
    expect(after.parts.gearbox.condition).toBe(1);
    expect(after.parts.gearbox.level).toBe(team.parts.gearbox.level);
  });

  it('gives a weaker part more from the same upgrade than a strong one', () => {
    const season = createSeason(config);
    const strong = season.teams.find((t) => t.teamId === 'meridian')!;
    const weak = season.teams.find((t) => t.teamId === 'corvid')!;
    const gainFor = (team: typeof strong) =>
      garageOptions(team).find((o) => o.id === 'engine-upgrade')!.gain;
    expect(gainFor(weak)).toBeGreaterThan(gainFor(strong));
  });

  it('wears the cars out over a season', () => {
    let season = createSeason(config);
    const before = season.teams.find((t) => t.teamId === 'kestros')!.parts.engine.condition;
    while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
    const after = season.teams.find((t) => t.teamId === 'kestros')!.parts.engine.condition;
    expect(after).toBeLessThan(before);
  });

  it('develops the AI teams without touching the player', () => {
    const season = createSeason(config);
    const developed = developAi(season);
    const playerBefore = season.teams.find((t) => t.teamId === 'kestros')!;
    const playerAfter = developed.teams.find((t) => t.teamId === 'kestros')!;
    expect(playerAfter.budget).toBe(playerBefore.budget);
    expect(playerAfter.parts).toEqual(playerBefore.parts);

    const rivalBefore = season.teams.find((t) => t.teamId === 'corvid')!;
    const rivalAfter = developed.teams.find((t) => t.teamId === 'corvid')!;
    expect(rivalAfter.budget).toBeLessThan(rivalBefore.budget);
  });
});

describe('racing the developed car', () => {
  it('hands the current stats to the race, not the catalogue ones', () => {
    let season = createSeason(config);
    const team = season.teams.find((t) => t.teamId === 'corvid')!;
    season = {
      ...season,
      teams: season.teams.map((t) => (t.teamId === 'corvid' ? { ...t, carPerformance: 1 } : t)),
    };
    const raceConfig = raceConfigFor(season);
    const raced = raceConfig.roster!.teams!.find((t) => t.id === 'corvid')!;
    expect(raced.carPerformance).toBe(1);
    expect(team.carPerformance).toBeLessThan(1);
  });
});
