import type { CarId, Classification, DriverId, Entry, TeamId } from '@undercut/engine';
import type { CarParts, PartId } from './parts.ts';

export type ChampionshipId = 'open-wheel' | 'endurance';

export interface SeasonConfig {
  championshipId: ChampionshipId;
  playerTeamId: TeamId;
  /** The calendar, in order. */
  trackIds: string[];
  /** Laps for a sprint championship, hours for an endurance one. */
  raceLength: number;
  seed: string;
}

/** A team's car as it stands today, which is not how it left the factory. */
export interface TeamDevelopment {
  teamId: TeamId;
  /** The car, component by component. Everything below is derived from it. */
  parts: CarParts;
  carPerformance: number;
  reliability: number;
  tyreWear: number;
  pitCrewSkill: number;
  /** Development money left for the rest of the season. */
  budget: number;
}

export interface RoundResult {
  round: number;
  trackId: string;
  seed: string;
  classification: Classification[];
}

export interface SeasonState {
  version: number;
  config: SeasonConfig;
  /** The round about to be run. Equal to the calendar length once finished. */
  round: number;
  teams: TeamDevelopment[];
  /** Who is driving what. Contracts change this between seasons. */
  entries: Entry[];
  results: RoundResult[];
}

export interface DriverStanding {
  driverId: DriverId;
  teamId: TeamId;
  carId: CarId;
  points: number;
  wins: number;
  podiums: number;
}

export interface TeamStanding {
  teamId: TeamId;
  points: number;
  wins: number;
}

export type GarageAction = 'upgrade' | 'repair';

export interface GarageOption {
  id: string;
  part: PartId;
  action: GarageAction;
  label: string;
  description: string;
  cost: number;
  /** What taking this would do: a level gain, or condition restored. */
  gain: number;
  affordable: boolean;
  /** Worth doing: an upgrade always is, a rebuild only once something is worn. */
  worthwhile: boolean;
}
