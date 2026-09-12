import type { Driver, DriverId, Team, TeamId } from '../types.ts';

/**
 * One place to resolve a driver or team by id, whichever ruleset they belong to.
 *
 * Content modules register themselves on import. The engine only ever looks
 * people up, so it never needs to know which championship they came from.
 */
const drivers = new Map<DriverId, Driver>();
const teams = new Map<TeamId, Team>();

export function registerDrivers(entries: readonly Driver[]): void {
  for (const driver of entries) drivers.set(driver.id, driver);
}

export function registerTeams(entries: readonly Team[]): void {
  for (const team of entries) teams.set(team.id, team);
}

export function driverById(id: DriverId): Driver {
  const driver = drivers.get(id);
  if (!driver) throw new Error(`Unknown driver: ${id}`);
  return driver;
}

export function teamById(id: TeamId): Team {
  const team = teams.get(id);
  if (!team) throw new Error(`Unknown team: ${id}`);
  return team;
}
