import type { Driver, Entry, Team } from '../types.ts';
import { registerDrivers, registerTeams } from './registry.ts';

/**
 * Ten invented teams, twenty invented drivers. No real-world motorsport
 * entity is referenced anywhere in this project.
 *
 * `carPerformance` and `skill` are the two balance dials that matter: the
 * statistical tests assert that a better value here wins more often.
 */
export const TEAMS: Team[] = [
  { id: 'meridian', name: 'Meridian Racing',   colour: '#e8412e', carPerformance: 1.00, pitCrewSkill: 0.94, reliability: 0.97 },
  { id: 'arcwright', name: 'Arcwright GP',     colour: '#2f6fe0', carPerformance: 0.98, pitCrewSkill: 0.91, reliability: 0.95 },
  { id: 'kestros', name: 'Kestros Motorsport', colour: '#12b886', carPerformance: 0.96, pitCrewSkill: 0.88, reliability: 0.93 },
  { id: 'valdor', name: 'Valdor Works',        colour: '#f2b705', carPerformance: 0.90, pitCrewSkill: 0.86, reliability: 0.91 },
  { id: 'northgate', name: 'Northgate Racing', colour: '#9b5de5', carPerformance: 0.86, pitCrewSkill: 0.83, reliability: 0.90 },
  { id: 'sable', name: 'Sable Automotive',     colour: '#ff8fab', carPerformance: 0.82, pitCrewSkill: 0.80, reliability: 0.88 },
  { id: 'oryx', name: 'Oryx Competition',      colour: '#00b4d8', carPerformance: 0.78, pitCrewSkill: 0.77, reliability: 0.86 },
  { id: 'halvard', name: 'Halvard Racing',     colour: '#8d99ae', carPerformance: 0.74, pitCrewSkill: 0.74, reliability: 0.84 },
  { id: 'brandt', name: 'Brandt Engineering',  colour: '#d68c45', carPerformance: 0.70, pitCrewSkill: 0.71, reliability: 0.82 },
  { id: 'corvid', name: 'Corvid Racing',       colour: '#5f6b7a', carPerformance: 0.66, pitCrewSkill: 0.68, reliability: 0.79 },
];

/**
 * Driver order matters: `defaultGrid` seats DRIVERS[i] at TEAMS[i], so this
 * list decides who gets the best machinery.
 *
 * The fastest driver is deliberately NOT in the fastest car. When they were
 * paired, one team won three races in four and the championship was over
 * before it started. Splitting them puts the best car and the best driver on
 * opposite sides of the grid, which is both a closer contest and a better
 * story.
 */
export const DRIVERS: Driver[] = [
  { id: 'd-ferreira', name: 'L. Ferreira',  skill: 0.94, consistency: 0.88, aggression: 0.86 },
  { id: 'd-navarro',  name: 'E. Navarro',   skill: 0.99, consistency: 0.95, aggression: 0.72 },
  { id: 'd-okonkwo',  name: 'T. Okonkwo',   skill: 0.97, consistency: 0.92, aggression: 0.79 },
  { id: 'd-brandt',   name: 'M. Brandt',    skill: 0.91, consistency: 0.90, aggression: 0.61 },
  { id: 'd-haugen',   name: 'S. Haugen',    skill: 0.93, consistency: 0.84, aggression: 0.88 },
  { id: 'd-rossi',    name: 'G. Rossi',     skill: 0.89, consistency: 0.86, aggression: 0.74 },
  { id: 'd-kaur',     name: 'P. Kaur',      skill: 0.90, consistency: 0.93, aggression: 0.66 },
  { id: 'd-delacroix',name: 'A. Delacroix', skill: 0.86, consistency: 0.81, aggression: 0.83 },
  { id: 'd-lindqvist',name: 'V. Lindqvist', skill: 0.87, consistency: 0.89, aggression: 0.58 },
  { id: 'd-adeyemi',  name: 'K. Adeyemi',   skill: 0.85, consistency: 0.78, aggression: 0.91 },
  { id: 'd-verhoeven',name: 'J. Verhoeven', skill: 0.83, consistency: 0.85, aggression: 0.69 },
  { id: 'd-santini',  name: 'R. Santini',   skill: 0.81, consistency: 0.76, aggression: 0.87 },
  { id: 'd-mbeki',    name: 'N. Mbeki',     skill: 0.80, consistency: 0.83, aggression: 0.64 },
  { id: 'd-yamada',   name: 'H. Yamada',    skill: 0.78, consistency: 0.88, aggression: 0.55 },
  { id: 'd-costa',    name: 'B. Costa',     skill: 0.76, consistency: 0.72, aggression: 0.90 },
  { id: 'd-novak',    name: 'I. Novak',     skill: 0.74, consistency: 0.80, aggression: 0.62 },
  { id: 'd-whitlock', name: 'C. Whitlock',  skill: 0.71, consistency: 0.75, aggression: 0.77 },
  { id: 'd-aziz',     name: 'F. Aziz',      skill: 0.69, consistency: 0.79, aggression: 0.59 },
  { id: 'd-petrov',   name: 'D. Petrov',    skill: 0.66, consistency: 0.70, aggression: 0.84 },
  { id: 'd-ellery',   name: 'W. Ellery',    skill: 0.62, consistency: 0.68, aggression: 0.73 },
];

registerTeams(TEAMS);
registerDrivers(DRIVERS);

export { driverById, teamById } from './registry.ts';

/**
 * Gives every team one senior driver and one junior, rather than handing the
 * fastest car both of the fastest drivers.
 *
 * The strict-rank pairing this replaces made the top team win 86% of races in
 * the balance suite: car quality and driver quality were perfectly correlated,
 * so nothing on the grid could ever produce an upset.
 */
export function defaultGrid(): Entry[] {
  const half = Math.floor(DRIVERS.length / 2);
  return TEAMS.flatMap((team, teamIndex) => {
    const first = DRIVERS[teamIndex];
    const second = DRIVERS[teamIndex + half];
    if (!first || !second) throw new Error('Driver pool too small for the team list');
    return [first, second].map((driver, seat) => ({
      carId: `${team.id}-${seat + 1}`,
      teamId: team.id,
      driverId: driver.id,
      classId: 'prototype',
      startingCompound: 'medium' as const,
    }));
  });
}
