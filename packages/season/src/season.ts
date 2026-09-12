import {
  defaultGrid,
  enduranceGrid,
  enduranceOverHours,
  ENDURANCE_TEAMS,
  openWheelOverLaps,
  simulate,
  TEAMS,
  teamById,
  trackById,
  type Driver,
  type Entry,
  type RaceConfig,
  type Team,
} from '@undercut/engine';
import { awardPoints } from './points.ts';
import type {
  DriverStanding,
  RoundResult,
  SeasonConfig,
  SeasonState,
  TeamDevelopment,
  TeamStanding,
  UpgradeArea,
  UpgradeOption,
} from './types.ts';

export const SEASON_VERSION = 1;

/** Nothing can be developed past this; the ratings are normalised to 1. */
const CEILING = 1;

/**
 * Development money for the season.
 *
 * The scale slides against performance on purpose: a team at the back gets
 * appreciably more to spend than the champion. Without it the fastest car
 * compounds its advantage every year and the championship is settled by round
 * three of season two.
 */
export function budgetFor(carPerformance: number): number {
  return Math.round(100 + (CEILING - carPerformance) * 320);
}

const AREA_LABEL: Record<UpgradeArea, string> = {
  aero: 'Aerodynamics',
  reliability: 'Reliability',
  pitCrew: 'Pit crew',
};

const AREA_DESCRIPTION: Record<UpgradeArea, string> = {
  aero: 'Lap time. The most direct way to move up the order.',
  reliability: 'Fewer cars stopping on track. Points you already earned.',
  pitCrew: 'Quicker stops, and fewer that go wrong.',
};

const TIERS = [
  { id: 'minor', label: 'Minor', cost: 40, factor: 0.25 },
  { id: 'major', label: 'Major', cost: 90, factor: 0.6 },
];

function ratingFor(team: TeamDevelopment, area: UpgradeArea): number {
  if (area === 'aero') return team.carPerformance;
  if (area === 'reliability') return team.reliability;
  return team.pitCrewSkill;
}

/**
 * What an upgrade is worth.
 *
 * Most of the gain scales with how much headroom a rating has left, so a poor
 * car improves faster than a good one — but the constant keeps a front-runner's
 * development from being pointless.
 */
function gainFor(team: TeamDevelopment, area: UpgradeArea, factor: number): number {
  const headroom = Math.max(0, CEILING - ratingFor(team, area));
  return factor * (0.25 * headroom + 0.02);
}

export function upgradeOptions(team: TeamDevelopment): UpgradeOption[] {
  const areas: UpgradeArea[] = ['aero', 'reliability', 'pitCrew'];
  return areas.flatMap((area) =>
    TIERS.map((tier) => ({
      id: `${area}-${tier.id}`,
      area,
      label: `${tier.label} ${AREA_LABEL[area].toLowerCase()}`,
      description: AREA_DESCRIPTION[area],
      cost: tier.cost,
      gain: gainFor(team, area, tier.factor),
      affordable: team.budget >= tier.cost,
    })),
  );
}

export function applyUpgrade(team: TeamDevelopment, option: UpgradeOption): TeamDevelopment {
  if (team.budget < option.cost) return team;
  const updated: TeamDevelopment = { ...team, budget: team.budget - option.cost };
  const raise = (value: number) => Math.min(CEILING, value + option.gain);
  if (option.area === 'aero') updated.carPerformance = raise(team.carPerformance);
  else if (option.area === 'reliability') updated.reliability = raise(team.reliability);
  else updated.pitCrewSkill = raise(team.pitCrewSkill);
  return updated;
}

/**
 * Rival teams spend between rounds, always on their weakest area.
 *
 * Deliberately simple and legible: the player should be able to predict roughly
 * where a rival is improving, and be beaten by a better plan rather than by a
 * hidden one.
 */
export function developAi(season: SeasonState): SeasonState {
  const teams = season.teams.map((team) => {
    if (team.teamId === season.config.playerTeamId) return team;
    const weakest: UpgradeArea = (['aero', 'reliability', 'pitCrew'] as UpgradeArea[]).sort(
      (a, b) => ratingFor(team, a) - ratingFor(team, b),
    )[0]!;
    const option = upgradeOptions(team)
      .filter((o) => o.area === weakest && o.affordable)
      .sort((a, b) => b.cost - a.cost)[0];
    return option ? applyUpgrade(team, option) : team;
  });
  return { ...season, teams };
}

function championshipTeams(championshipId: SeasonConfig['championshipId']): Team[] {
  return championshipId === 'endurance' ? ENDURANCE_TEAMS : TEAMS;
}

function championshipGrid(championshipId: SeasonConfig['championshipId']): Entry[] {
  return championshipId === 'endurance' ? enduranceGrid() : defaultGrid();
}

export function createSeason(config: SeasonConfig): SeasonState {
  const teams = championshipTeams(config.championshipId).map<TeamDevelopment>((team) => ({
    teamId: team.id,
    carPerformance: team.carPerformance,
    reliability: team.reliability,
    pitCrewSkill: team.pitCrewSkill,
    budget: budgetFor(team.carPerformance),
  }));

  return {
    version: SEASON_VERSION,
    config,
    round: 0,
    teams,
    entries: championshipGrid(config.championshipId),
    results: [],
  };
}

export function isSeasonComplete(season: SeasonState): boolean {
  return season.round >= season.config.trackIds.length;
}

export function nextRound(season: SeasonState): { round: number; trackId: string } | null {
  if (isSeasonComplete(season)) return null;
  return { round: season.round, trackId: season.config.trackIds[season.round]! };
}

export function roundSeed(season: SeasonState, round: number): string {
  return `${season.config.seed}-r${round + 1}-${season.config.trackIds[round]}`;
}

/** The race about to be run, with every car at the stats it currently has. */
export function raceConfigFor(season: SeasonState, playerCarId?: string | null): RaceConfig {
  const round = nextRound(season);
  if (!round) throw new Error('The season is over; there is no round to configure');

  const teams: Team[] = season.teams.map((development) => ({
    ...teamById(development.teamId),
    carPerformance: development.carPerformance,
    reliability: development.reliability,
    pitCrewSkill: development.pitCrewSkill,
  }));

  const regulations =
    season.config.championshipId === 'endurance'
      ? enduranceOverHours(season.config.raceLength)
      : openWheelOverLaps(season.config.raceLength);

  return {
    track: trackById(round.trackId),
    regulations,
    entries: season.entries,
    startingWeather: 'dry',
    playerCarId: playerCarId ?? null,
    roster: { teams },
  };
}

/** Runs the next round headlessly. The interface plays it out lap by lap instead. */
export function runRound(season: SeasonState): RoundResult {
  const round = nextRound(season);
  if (!round) throw new Error('The season is over; there is no round to run');
  const seed = roundSeed(season, round.round);
  const result = simulate(raceConfigFor(season), seed);
  return {
    round: round.round,
    trackId: round.trackId,
    seed,
    classification: result.classification,
  };
}

/** Files a result, moves the season on, and lets the rivals develop. */
export function recordResult(season: SeasonState, result: RoundResult): SeasonState {
  const advanced: SeasonState = {
    ...season,
    round: season.round + 1,
    results: [...season.results, result],
  };
  return isSeasonComplete(advanced) ? advanced : developAi(advanced);
}

export function driverStandings(season: SeasonState): DriverStanding[] {
  const standings = new Map<string, DriverStanding>();
  for (const entry of season.entries) {
    standings.set(entry.carId, {
      driverId: entry.driverId,
      teamId: entry.teamId,
      carId: entry.carId,
      points: 0,
      wins: 0,
      podiums: 0,
    });
  }

  for (const result of season.results) {
    const awarded = awardPoints(result.classification);
    for (const [carId, points] of awarded) {
      const standing = standings.get(carId);
      if (standing) standing.points += points;
    }
    for (const car of result.classification) {
      const standing = standings.get(car.carId);
      if (!standing || car.retired) continue;
      if (car.classPosition === 1) standing.wins += 1;
      if (car.classPosition <= 3) standing.podiums += 1;
    }
  }

  return [...standings.values()].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums,
  );
}

export function teamStandings(season: SeasonState): TeamStanding[] {
  const totals = new Map<string, TeamStanding>();
  for (const team of season.teams) {
    totals.set(team.teamId, { teamId: team.teamId, points: 0, wins: 0 });
  }
  for (const driver of driverStandings(season)) {
    const team = totals.get(driver.teamId);
    if (!team) continue;
    team.points += driver.points;
    team.wins += driver.wins;
  }
  return [...totals.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
}

export type { Driver };
