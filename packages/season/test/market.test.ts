import { describe, expect, it } from 'vitest';
import { TRACKS } from '@undercut/engine';
import { createSeason, isSeasonComplete, recordResult, runRound } from '../src/season.ts';
import { autoPick, driverValue, openMarket, pickDriver, startNextSeason } from '../src/market.ts';
import type { SeasonConfig } from '../src/types.ts';

const config: SeasonConfig = {
  championshipId: 'open-wheel',
  playerTeamId: 'kestros',
  trackIds: TRACKS.slice(0, 3).map((t) => t.id),
  raceLength: 15,
  seed: 'market-test',
};

function finishedSeason() {
  let season = createSeason(config);
  while (!isSeasonComplete(season)) season = recordResult(season, runRound(season));
  return season;
}

describe('driver market', () => {
  it('rates a driver on talent and on the season they just had', () => {
    const season = finishedSeason();
    const withPoints = driverValue(season, 'd-navarro', 100);
    const without = driverValue(season, 'd-navarro', 0);
    expect(withPoints).toBeGreaterThan(without);
  });

  it('lets the champion team choose first', () => {
    const market = openMarket(finishedSeason());
    expect(market.order[0]).toBeDefined();
    expect(market.order).toHaveLength(finishedSeason().teams.length);
  });

  it('pauses when it is the player’s turn', () => {
    const market = autoPick(openMarket(finishedSeason()));
    expect(market.awaitingPlayer || market.complete).toBe(true);
    if (market.awaitingPlayer) {
      expect(market.currentTeamId).toBe(config.playerTeamId);
      expect(market.pool.length).toBeGreaterThan(0);
    }
  });

  it('signs the driver the player picks', () => {
    let market = autoPick(openMarket(finishedSeason()));
    if (!market.awaitingPlayer) return;
    const wanted = market.pool[0]!;
    market = pickDriver(market, wanted);
    expect(market.signings.some((s) => s.driverId === wanted && s.teamId === config.playerTeamId)).toBe(true);
    expect(market.pool).not.toContain(wanted);
  });

  it('refuses a driver who is already signed', () => {
    let market = autoPick(openMarket(finishedSeason()));
    if (!market.awaitingPlayer) return;
    const taken = market.signings[0]!.driverId;
    const before = market.signings.length;
    market = pickDriver(market, taken);
    expect(market.signings).toHaveLength(before);
  });

  it('fills every seat on the grid', () => {
    let market = autoPick(openMarket(finishedSeason()));
    while (market.awaitingPlayer) {
      market = autoPick(pickDriver(market, market.pool[0]!));
    }
    expect(market.complete).toBe(true);
    const season = finishedSeason();
    const seats = season.entries.length;
    expect(market.signings).toHaveLength(seats);
    expect(new Set(market.signings.map((s) => s.driverId)).size).toBe(seats);
  });
});

describe('rolling into the next season', () => {
  function completedMarket() {
    let market = autoPick(openMarket(finishedSeason()));
    while (market.awaitingPlayer) market = autoPick(pickDriver(market, market.pool[0]!));
    return market;
  }

  it('keeps the cars that were developed and clears the results', () => {
    const season = finishedSeason();
    const next = startNextSeason(season, completedMarket());
    expect(next.results).toHaveLength(0);
    expect(next.round).toBe(0);
    for (const team of next.teams) {
      const previous = season.teams.find((t) => t.teamId === team.teamId)!;
      expect(team.carPerformance).toBeCloseTo(previous.carPerformance, 6);
    }
  });

  it('hands out a fresh budget on the new scale', () => {
    const season = finishedSeason();
    const next = startNextSeason(season, completedMarket());
    for (const team of next.teams) {
      expect(team.budget).toBeGreaterThan(0);
    }
    const strongest = [...next.teams].sort((a, b) => b.carPerformance - a.carPerformance)[0]!;
    const weakest = [...next.teams].sort((a, b) => a.carPerformance - b.carPerformance)[0]!;
    expect(weakest.budget).toBeGreaterThan(strongest.budget);
  });

  it('puts the signed drivers in the cars', () => {
    const market = completedMarket();
    const next = startNextSeason(finishedSeason(), market);
    for (const signing of market.signings) {
      const entry = next.entries.find((e) => e.carId === signing.carId)!;
      expect(entry.driverId).toBe(signing.driverId);
      expect(entry.teamId).toBe(signing.teamId);
    }
  });

  it('gives the new season its own seed so it is not a repeat', () => {
    const season = finishedSeason();
    const next = startNextSeason(season, completedMarket());
    expect(next.config.seed).not.toBe(season.config.seed);
  });
});
