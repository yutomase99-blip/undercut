import type { Driver, Entry, Team } from '../types.ts';
import { ENDURANCE_CLASSES } from '../rules/endurance.ts';
import { registerDrivers, registerTeams } from './registry.ts';

/**
 * A twenty-four car, three-class field. Every name is invented.
 *
 * Crews are built from a fixed list rather than written out one by one: what
 * matters for the simulation is the shape of each crew — a quick lead driver
 * and progressively slower team-mates — not seventy-two hand-tuned people.
 */
const SURNAMES = [
  'Achterberg', 'Baumann', 'Calvert', 'Duarte', 'Eriksen', 'Fontaine',
  'Grimaldi', 'Halloran', 'Ishikawa', 'Jansen', 'Kovac', 'Lombardi',
  'Marchetti', 'Nyström', 'Oyelaran', 'Pereira', 'Quintero', 'Rasmussen',
  'Steiner', 'Thibault', 'Ueda', 'Vasquez', 'Wexler', 'Yilmaz',
  'Andrade', 'Bergström', 'Castellanos', 'Dumont', 'Engel', 'Falkner',
  'Gaultier', 'Hoffmann', 'Ivarsson', 'Jourdain', 'Keller', 'Laurent',
  'Moreau', 'Nakamura', 'Olsen', 'Pichler', 'Quesnel', 'Rinaldi',
  'Schuster', 'Tanaka', 'Ullrich', 'Varga', 'Wallenberg', 'Xavier',
  'Ashworth', 'Boucher', 'Cardoso', 'Deschamps', 'Edvardsen', 'Fiorentino',
  'Gundersen', 'Haraldsen', 'Imamura', 'Jegede', 'Krauss', 'Lindgren',
  'Matsuda', 'Norrback', 'Ortega', 'Pedersen', 'Quiroga', 'Renard',
  'Sandoval', 'Tomasi', 'Utterback', 'Voss', 'Wiberg', 'Zieliński',
];

const INITIALS = 'ABCDEFGHJKLMNPRSTVW';

/** Lead, second and third driver ratings for each class. */
const CREW_SHAPE: Record<string, { skill: number; consistency: number; aggression: number }[]> = {
  hypercar: [
    { skill: 0.97, consistency: 0.93, aggression: 0.74 },
    { skill: 0.92, consistency: 0.89, aggression: 0.78 },
    { skill: 0.86, consistency: 0.84, aggression: 0.7 },
  ],
  lmp2: [
    { skill: 0.89, consistency: 0.86, aggression: 0.82 },
    { skill: 0.83, consistency: 0.81, aggression: 0.76 },
    { skill: 0.74, consistency: 0.75, aggression: 0.68 },
  ],
  gt: [
    { skill: 0.84, consistency: 0.85, aggression: 0.71 },
    { skill: 0.77, consistency: 0.79, aggression: 0.73 },
    { skill: 0.67, consistency: 0.71, aggression: 0.64 },
  ],
};

/** How many cars each class fields, and the teams that run them. */
const ENTRY_PLAN: { classId: string; teams: { id: string; name: string; colour: string; carPerformance: number }[] }[] = [
  {
    classId: 'hypercar',
    teams: [
      { id: 'e-aurelia', name: 'Aurelia Corse', colour: '#e8412e', carPerformance: 1.0 },
      { id: 'e-bellwether', name: 'Bellwether Racing', colour: '#2f6fe0', carPerformance: 0.97 },
      { id: 'e-caldera', name: 'Caldera Motorsport', colour: '#12b886', carPerformance: 0.94 },
      { id: 'e-drakon', name: 'Drakon Works', colour: '#f2b705', carPerformance: 0.9 },
      { id: 'e-emberly', name: 'Emberly Sport', colour: '#9b5de5', carPerformance: 0.87 },
      { id: 'e-fenwick', name: 'Fenwick Competition', colour: '#00b4d8', carPerformance: 0.84 },
    ],
  },
  {
    classId: 'lmp2',
    teams: [
      { id: 'e-galena', name: 'Galena Prototypes', colour: '#ff8fab', carPerformance: 0.98 },
      { id: 'e-hollis', name: 'Hollis Racing', colour: '#4d9dff', carPerformance: 0.95 },
      { id: 'e-ironwood', name: 'Ironwood Team', colour: '#8d99ae', carPerformance: 0.92 },
      { id: 'e-juniper', name: 'Juniper Sport', colour: '#d68c45', carPerformance: 0.89 },
      { id: 'e-kalmar', name: 'Kalmar Racing', colour: '#35d07f', carPerformance: 0.86 },
      { id: 'e-lyric', name: 'Lyric Motorsport', colour: '#b06cf5', carPerformance: 0.83 },
      { id: 'e-mistral', name: 'Mistral Endurance', colour: '#f07167', carPerformance: 0.8 },
      { id: 'e-nordlys', name: 'Nordlys Racing', colour: '#7cc5c0', carPerformance: 0.77 },
    ],
  },
  {
    classId: 'gt',
    teams: [
      { id: 'e-orvieto', name: 'Orvieto Squadra', colour: '#c1121f', carPerformance: 1.0 },
      { id: 'e-pallas', name: 'Pallas Competizione', colour: '#457b9d', carPerformance: 0.97 },
      { id: 'e-quarry', name: 'Quarry Lane Racing', colour: '#e9c46a', carPerformance: 0.94 },
      { id: 'e-ravenna', name: 'Ravenna Corse', colour: '#2a9d8f', carPerformance: 0.91 },
      { id: 'e-solstice', name: 'Solstice Racing', colour: '#e76f51', carPerformance: 0.88 },
      { id: 'e-tamarind', name: 'Tamarind Racing', colour: '#a68a64', carPerformance: 0.85 },
      { id: 'e-ulster', name: 'Ulster Motorsport', colour: '#6a994e', carPerformance: 0.82 },
      { id: 'e-vantage', name: 'Vantage Crew', colour: '#bc6c25', carPerformance: 0.79 },
      { id: 'e-wildgoose', name: 'Wildgoose Racing', colour: '#8e9aaf', carPerformance: 0.76 },
      { id: 'e-yarrow', name: 'Yarrow Competition', colour: '#cdb4db', carPerformance: 0.73 },
    ],
  },
];

const teams: Team[] = [];
const drivers: Driver[] = [];
const entries: Entry[] = [];

let nameCursor = 0;
for (const group of ENTRY_PLAN) {
  const shape = CREW_SHAPE[group.classId]!;
  for (const teamSpec of group.teams) {
    teams.push({
      id: teamSpec.id,
      name: teamSpec.name,
      colour: teamSpec.colour,
      carPerformance: teamSpec.carPerformance,
      // Endurance crews are drilled; the spread between them is narrower than
      // in a sprint championship, where a single slow stop loses the race.
      pitCrewSkill: 0.78 + (teamSpec.carPerformance - 0.73) * 0.5,
      reliability: 0.88 + (teamSpec.carPerformance - 0.73) * 0.25,
    });

    const crew = shape.map((ratings, seat) => {
      const surname = SURNAMES[nameCursor % SURNAMES.length]!;
      const initial = INITIALS[nameCursor % INITIALS.length]!;
      nameCursor += 1;
      return {
        id: `${teamSpec.id}-d${seat + 1}`,
        name: `${initial}. ${surname}`,
        ...ratings,
      } satisfies Driver;
    });
    drivers.push(...crew);

    entries.push({
      carId: `${teamSpec.id}-1`,
      teamId: teamSpec.id,
      driverId: crew[0]!.id,
      driverIds: crew.map((d) => d.id),
      classId: group.classId,
      startingCompound: 'medium',
    });
  }
}

export const ENDURANCE_TEAMS: Team[] = teams;
export const ENDURANCE_DRIVERS: Driver[] = drivers;

registerTeams(ENDURANCE_TEAMS);
registerDrivers(ENDURANCE_DRIVERS);

/** The full three-class field: 6 Hypercars, 8 LMP2, 10 GT. */
export function enduranceGrid(): Entry[] {
  return entries.map((entry) => ({ ...entry, driverIds: [...(entry.driverIds ?? [])] }));
}

export { ENDURANCE_CLASSES };
