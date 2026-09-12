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
  upgradeOptions,
  applyUpgrade,
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
      expect(development.carPerformance).toBeCloseTo(team.carPerformance, 6);
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

describe('development', () => {
  it('gives the slower teams more to spend', () => {
    const best = budgetFor(1.0);
    const worst = budgetFor(0.66);
    expect(worst).toBeGreaterThan(best);
  });

  it('offers upgrades a team can afford and refuses ones it cannot', () => {
    const season = createSeason(config);
    const team = season.teams.find((t) => t.teamId === 'kestros')!;
    const options = upgradeOptions(team);
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => o.cost <= team.budget)).toBe(true);
    const broke = { ...team, budget: 0 };
    expect(upgradeOptions(broke).every((o) => !o.affordable)).toBe(true);
  });

  it('spends budget and improves the car', () => {
    const season = createSeason(config);
    const team = season.teams.find((t) => t.teamId === 'kestros')!;
    const option = upgradeOptions(team).find((o) => o.area === 'aero' && o.affordable)!;
    const after = applyUpgrade(team, option);
    expect(after.budget).toBe(team.budget - option.cost);
    expect(after.carPerformance).toBeGreaterThan(team.carPerformance);
  });

  it('gives a weak car more from the same upgrade than a strong one', () => {
    const season = createSeason(config);
    const strong = season.teams.find((t) => t.teamId === 'meridian')!;
    const weak = season.teams.find((t) => t.teamId === 'corvid')!;
    const gainFor = (team: typeof strong) => {
      const option = upgradeOptions(team).find((o) => o.area === 'aero' && o.affordable)!;
      return applyUpgrade(team, option).carPerformance - team.carPerformance;
    };
    expect(gainFor(weak)).toBeGreaterThan(gainFor(strong));
  });

  it('never pushes a rating above its ceiling', () => {
    let team = { ...createSeason(config).teams[0]!, budget: 1_000_000, carPerformance: 0.999 };
    for (let i = 0; i < 40; i += 1) {
      const option = upgradeOptions(team).find((o) => o.area === 'aero' && o.affordable);
      if (!option) break;
      team = applyUpgrade(team, option);
    }
    expect(team.carPerformance).toBeLessThanOrEqual(1);
  });

  it('develops the AI teams without touching the player', () => {
    const season = createSeason(config);
    const developed = developAi(season);
    const playerBefore = season.teams.find((t) => t.teamId === 'kestros')!;
    const playerAfter = developed.teams.find((t) => t.teamId === 'kestros')!;
    expect(playerAfter.carPerformance).toBe(playerBefore.carPerformance);
    expect(playerAfter.budget).toBe(playerBefore.budget);

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
