import { driverById, DRIVERS, ENDURANCE_DRIVERS, type DriverId, type Entry, type TeamId } from '@undercut/engine';
import { budgetFor, driverStandings, SEASON_VERSION } from './season.ts';
import type { SeasonState } from './types.ts';

export interface Signing {
  teamId: TeamId;
  carId: string;
  /** Which seat in the car: always 0 in a single-driver championship. */
  slot: number;
  driverId: DriverId;
}

interface Seat {
  teamId: TeamId;
  carId: string;
  slot: number;
}

export interface MarketState {
  season: SeasonState;
  /** Teams in championship order: the champion chooses first. */
  order: TeamId[];
  seats: Seat[];
  cursor: number;
  pool: DriverId[];
  signings: Signing[];
  awaitingPlayer: boolean;
  currentTeamId: TeamId | null;
  complete: boolean;
}

/**
 * What a driver is worth to a team: mostly raw talent, partly the season they
 * have just had. A strong year in a poor car still gets you noticed.
 */
export function driverValue(season: SeasonState, driverId: DriverId, points: number): number {
  const driver = driverById(driverId);
  const best = Math.max(1, ...driverStandings(season).map((s) => s.points));
  return driver.skill * 0.7 + (points / best) * 0.3;
}

function poolFor(season: SeasonState): DriverId[] {
  const registered =
    season.config.championshipId === 'endurance' ? ENDURANCE_DRIVERS : DRIVERS;
  return registered.map((d) => d.id);
}

/**
 * Seats are filled round by round rather than team by team, so the champion
 * gets first choice of lead drivers but cannot simply take the best two people
 * on the grid before anyone else has spoken.
 */
function seatsInDraftOrder(season: SeasonState, order: TeamId[]): Seat[] {
  const byTeam = new Map<TeamId, Entry[]>();
  for (const entry of season.entries) {
    byTeam.set(entry.teamId, [...(byTeam.get(entry.teamId) ?? []), entry]);
  }

  const slotsPerEntry = (entry: Entry) => entry.driverIds?.length ?? 1;
  const maxSeats = Math.max(
    ...season.entries.map((entry) => slotsPerEntry(entry)),
    1,
  );
  const maxCars = Math.max(...[...byTeam.values()].map((entries) => entries.length), 1);

  const seats: Seat[] = [];
  for (let slot = 0; slot < maxSeats; slot += 1) {
    for (let carIndex = 0; carIndex < maxCars; carIndex += 1) {
      for (const teamId of order) {
        const entry = byTeam.get(teamId)?.[carIndex];
        if (!entry || slot >= slotsPerEntry(entry)) continue;
        seats.push({ teamId, carId: entry.carId, slot });
      }
    }
  }
  return seats;
}

export function openMarket(season: SeasonState): MarketState {
  const order = [...season.teams]
    .map((team) => team.teamId)
    .sort((a, b) => {
      const standings = driverStandings(season);
      const pointsFor = (teamId: TeamId) =>
        standings.filter((s) => s.teamId === teamId).reduce((sum, s) => sum + s.points, 0);
      return pointsFor(b) - pointsFor(a);
    });

  const market: MarketState = {
    season,
    order,
    seats: seatsInDraftOrder(season, order),
    cursor: 0,
    pool: poolFor(season),
    signings: [],
    awaitingPlayer: false,
    currentTeamId: null,
    complete: false,
  };
  return sync(market);
}

function sync(market: MarketState): MarketState {
  if (market.cursor >= market.seats.length) {
    return { ...market, complete: true, awaitingPlayer: false, currentTeamId: null };
  }
  const seat = market.seats[market.cursor]!;
  return {
    ...market,
    complete: false,
    currentTeamId: seat.teamId,
    awaitingPlayer: seat.teamId === market.season.config.playerTeamId,
  };
}

function sign(market: MarketState, driverId: DriverId): MarketState {
  const seat = market.seats[market.cursor];
  if (!seat) return market;
  return sync({
    ...market,
    cursor: market.cursor + 1,
    pool: market.pool.filter((id) => id !== driverId),
    signings: [...market.signings, { ...seat, driverId }],
  });
}

/** Runs the rival teams' choices until the player is on the clock, or it is done. */
export function autoPick(market: MarketState): MarketState {
  let current = sync(market);
  const pointsByDriver = new Map(
    driverStandings(current.season).map((s) => [s.driverId, s.points] as const),
  );

  while (!current.complete && !current.awaitingPlayer) {
    const best = [...current.pool].sort(
      (a, b) =>
        driverValue(current.season, b, pointsByDriver.get(b) ?? 0) -
        driverValue(current.season, a, pointsByDriver.get(a) ?? 0),
    )[0];
    if (!best) return { ...current, complete: true, awaitingPlayer: false };
    current = sign(current, best);
  }
  return current;
}

export function pickDriver(market: MarketState, driverId: DriverId): MarketState {
  if (!market.awaitingPlayer || !market.pool.includes(driverId)) return market;
  return sign(market, driverId);
}

/**
 * Rolls a finished season into the next one: the cars keep everything they were
 * developed into, the budgets are handed out afresh on the sliding scale, and
 * the signed drivers take their seats.
 */
export function startNextSeason(season: SeasonState, market: MarketState): SeasonState {
  const byCar = new Map<string, Signing[]>();
  for (const signing of market.signings) {
    byCar.set(signing.carId, [...(byCar.get(signing.carId) ?? []), signing]);
  }

  const entries: Entry[] = season.entries.map((entry) => {
    const signings = (byCar.get(entry.carId) ?? []).sort((a, b) => a.slot - b.slot);
    if (signings.length === 0) return entry;
    const driverIds = signings.map((s) => s.driverId);
    return {
      ...entry,
      driverId: driverIds[0]!,
      ...(entry.driverIds ? { driverIds } : {}),
    };
  });

  return {
    version: SEASON_VERSION,
    config: { ...season.config, seed: `${season.config.seed}-next` },
    round: 0,
    teams: season.teams.map((team) => ({
      ...team,
      budget: budgetFor(team.carPerformance),
    })),
    entries,
    results: [],
  };
}
