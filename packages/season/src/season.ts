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
import {
  PART_IDS,
  PART_LABEL,
  PART_NOTE,
  carPerformanceFrom,
  fitPartsFor,
  partCost,
  reliabilityFrom,
  repairPart,
  runWear,
  tyreWearFrom,
  upgradePart,
  type CarParts,
  type PartId,
} from './parts.ts';
import type {
  DriverStanding,
  GarageOption,
  RoundResult,
  SeasonConfig,
  SeasonState,
  TeamDevelopment,
  TeamStanding,
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

/** Everything about a car that the race needs, read back off its parts. */
export function syncDerived(team: TeamDevelopment): TeamDevelopment {
  return {
    ...team,
    carPerformance: carPerformanceFrom(team.parts),
    reliability: reliabilityFrom(team.parts),
    tyreWear: tyreWearFrom(team.parts),
  };
}

/**
 * What the garage can do this week.
 *
 * Upgrades make a part better and rebuilds make it new again, and the budget
 * has to cover both. That is the trade the old single development number could
 * not express: a quicker engine, or a gearbox that will still be there in
 * November.
 */
export function garageOptions(team: TeamDevelopment): GarageOption[] {
  const options: GarageOption[] = [];
  for (const id of PART_IDS) {
    const part = team.parts[id];

    const upgradeCost = partCost(id, 'upgrade');
    const upgraded = upgradePart(team.parts, id)[id].level;
    options.push({
      id: `${id}-upgrade`,
      part: id,
      action: 'upgrade',
      label: `Upgrade ${PART_LABEL[id].toLowerCase()}`,
      description: PART_NOTE[id],
      cost: upgradeCost,
      gain: upgraded - part.level,
      affordable: team.budget >= upgradeCost,
      worthwhile: part.level < 0.999,
    });

    const repairCost = partCost(id, 'repair');
    options.push({
      id: `${id}-repair`,
      part: id,
      action: 'repair',
      label: `Rebuild ${PART_LABEL[id].toLowerCase()}`,
      description: PART_NOTE[id],
      cost: repairCost,
      gain: 1 - part.condition,
      affordable: team.budget >= repairCost,
      worthwhile: part.condition < 0.95,
    });
  }
  return options;
}

export function applyGarageOption(team: TeamDevelopment, option: GarageOption): TeamDevelopment {
  if (team.budget < option.cost) return team;
  const parts: CarParts =
    option.action === 'upgrade'
      ? upgradePart(team.parts, option.part)
      : repairPart(team.parts, option.part);
  return syncDerived({ ...team, parts, budget: team.budget - option.cost });
}

/**
 * Rival teams spend between rounds.
 *
 * Deliberately legible: anything worn badly enough gets rebuilt first, and
 * otherwise the weakest part that makes the car quicker gets the money. The
 * player should be beaten by a better plan, not a hidden one.
 */
export function developAi(season: SeasonState): SeasonState {
  const teams = season.teams.map((team) => {
    if (team.teamId === season.config.playerTeamId) return team;

    const options = garageOptions(team).filter((o) => o.affordable && o.worthwhile);
    const urgentRebuild = options
      .filter((o) => o.action === 'repair' && team.parts[o.part].condition < 0.4)
      .sort((a, b) => team.parts[a.part].condition - team.parts[b.part].condition)[0];
    if (urgentRebuild) return applyGarageOption(team, urgentRebuild);

    const bestUpgrade = options
      .filter((o) => o.action === 'upgrade' && ['engine', 'aero', 'chassis'].includes(o.part))
      .sort((a, b) => b.gain - a.gain)[0];
    return bestUpgrade ? applyGarageOption(team, bestUpgrade) : team;
  });
  return { ...season, teams };
}

/** A race's worth of wear on every car. */
export function wearField(season: SeasonState, distance = 1): SeasonState {
  return {
    ...season,
    teams: season.teams.map((team) => syncDerived({ ...team, parts: runWear(team.parts, distance) })),
  };
}

export type { PartId };

function championshipTeams(championshipId: SeasonConfig['championshipId']): Team[] {
  return championshipId === 'endurance' ? ENDURANCE_TEAMS : TEAMS;
}

function championshipGrid(championshipId: SeasonConfig['championshipId']): Entry[] {
  return championshipId === 'endurance' ? enduranceGrid() : defaultGrid();
}

export function createSeason(config: SeasonConfig): SeasonState {
  const teams = championshipTeams(config.championshipId).map<TeamDevelopment>((team) =>
    syncDerived({
      teamId: team.id,
      parts: fitPartsFor(team),
      carPerformance: team.carPerformance,
      reliability: team.reliability,
      tyreWear: 1,
      pitCrewSkill: team.pitCrewSkill,
      budget: budgetFor(team.carPerformance),
    }),
  );

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
    tyreWear: development.tyreWear,
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
    // Each round decides its own conditions from that round's seed.
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
  const advanced: SeasonState = wearField({
    ...season,
    round: season.round + 1,
    results: [...season.results, result],
  });
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
