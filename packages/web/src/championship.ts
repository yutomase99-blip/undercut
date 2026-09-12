import {
  defaultGrid,
  enduranceGrid,
  ENDURANCE_CLASSES,
  ENDURANCE_TEAMS,
  enduranceOverHours,
  openWheelOverLaps,
  TEAMS,
  type Entry,
  type Regulations,
  type Team,
  type Track,
} from '@undercut/engine';

/**
 * What the player is choosing between on the front page.
 *
 * The two championships differ in almost everything the interface has to show
 * — a clock instead of a lap count, classes instead of one field, a crew
 * instead of a driver — so the difference is described once, here, rather than
 * branched on all over the UI.
 */
export interface Championship {
  id: string;
  name: string;
  blurb: string;
  teams: Team[];
  grid: () => Entry[];
  /** Race length unit shown on the setup screen. */
  lengthLabel: string;
  lengthMin: number;
  lengthMax: number;
  defaultLength: (track: Track) => number;
  regulations: (length: number) => Regulations;
  multiClass: boolean;
}

export const CHAMPIONSHIPS: Championship[] = [
  {
    id: 'open-wheel',
    name: 'Open-Wheel',
    blurb: 'One class, one driver, a mandatory tyre change. Sprint distance.',
    teams: TEAMS,
    grid: defaultGrid,
    lengthLabel: 'Laps',
    lengthMin: 5,
    lengthMax: 90,
    defaultLength: (track) => track.defaultLaps,
    regulations: openWheelOverLaps,
    multiClass: false,
  },
  {
    id: 'endurance',
    name: 'Endurance',
    blurb: 'Three classes, three drivers a car, refuelling, and a race against the clock.',
    teams: ENDURANCE_TEAMS,
    grid: enduranceGrid,
    lengthLabel: 'Hours',
    lengthMin: 1,
    lengthMax: 24,
    defaultLength: () => 6,
    regulations: enduranceOverHours,
    multiClass: true,
  },
];

/** Short tag shown against each car in a multi-class field. */
export const CLASS_TAG: Record<string, string> = {
  hypercar: 'HY',
  lmp2: 'LMP2',
  gt: 'GT',
};

export const CLASS_COLOUR: Record<string, string> = {
  hypercar: '#e8412e',
  lmp2: '#4d9dff',
  gt: '#35d07f',
};

export { ENDURANCE_CLASSES };
