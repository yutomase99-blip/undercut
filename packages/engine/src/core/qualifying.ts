import type {
  CarId,
  CompoundId,
  Driver,
  RaceConfig,
  Team,
  WeatherState,
} from '../types.ts';
import { COMPOUNDS } from '../content/compounds.ts';
import { driverById, teamById } from '../content/registry.ts';
import { createStreams, type Rng, type Streams } from '../rng/streams.ts';
import { allocationFor, availableCompound, takeSet, type TyreAllocation } from './allocation.ts';
import { computeLapTime } from './lapTime.ts';
import { rollStartingWeather, suitableCompounds, WETNESS_FOR } from './weather.ts';

/** Fuel carried on a qualifying run: as little as the rules allow. */
const QUALIFYING_FUEL_KG = 12;
/** How much quicker the track gets between the first slot and the last. */
const EVOLUTION_MS = 900;
/** Time lost per other car sharing your window. */
const TRAFFIC_MS_PER_CAR = 55;
/** Chance of the flags coming out in the first window of a session. */
const YELLOW_EARLY = 0.01;
/** Additional chance by the last window, when everybody is out and pushing. */
const YELLOW_LATE = 0.07;
/** A qualifying tyre is one lap old: warm, and at its peak. */
const TYRE_AGE_LAPS = 1;

export interface QualifyingRun {
  carId: CarId;
  slot: number;
  compound: CompoundId;
}

export interface QualifyingLap {
  carId: CarId;
  segment: number;
  slot: number;
  compound: CompoundId;
  /** null when the lap was never completed, or was deleted under yellow flags. */
  timeMs: number | null;
  deleted: boolean;
}

export interface QualifyingState {
  segment: number;
  segmentName: string;
  slots: number;
  runners: CarId[];
  complete: boolean;
}

export interface QualifyingResult {
  /** The grid, front to back. */
  grid: CarId[];
  /** What each car has left in the garage for the race. */
  allocations: Map<CarId, TyreAllocation>;
  laps: QualifyingLap[];
  /** Which segment a car was knocked out in. Absent for cars that survived. */
  eliminatedAt: Map<CarId, number>;
  /**
   * Cars that reached the final segment start the race on the tyre they set
   * their best time on. Everyone else is free to choose.
   */
  startingCompounds: Map<CarId, CompoundId>;
}

export interface Qualifying {
  state(): QualifyingState;
  /** Books a car's run. Any car without one is given a plan by its engineers. */
  planRun(run: QualifyingRun): void;
  /** Runs the current segment and returns the laps it produced. */
  runSegment(): QualifyingLap[];
  isComplete(): boolean;
  result(): QualifyingResult;
  /** Track surface at a given slot: negative once rubber is down. */
  surfaceMsAt(slot: number): number;
  /** Time lost with this many cars in one window. */
  trafficMsFor(carsInSlot: number): number;
  /**
   * How many cars are currently expected in each slot this segment, so the
   * player can weigh a rubbered-in track against a crowded one.
   */
  forecast(): number[];
  /** Odds of the flags ending every lap in this window. */
  yellowChanceAt(slot: number): number;
  /** What a car still has in the garage. */
  allocationOf(carId: CarId): TyreAllocation;
  /** The conditions this session is being run in. */
  conditions(): WeatherState;
}

export function createQualifying(config: RaceConfig, seed: string): Qualifying {
  const streams: Streams = createStreams(`${seed}::qualifying`);
  const rng: Rng = streams.qualifying;
  const { track, regulations, entries } = config;
  const { slots, segments, format } = regulations.qualifying;

  const teamOverrides = new Map((config.roster?.teams ?? []).map((t) => [t.id, t]));
  const driverOverrides = new Map((config.roster?.drivers ?? []).map((d) => [d.id, d]));
  const resolveTeam = (id: string): Team => teamOverrides.get(id) ?? teamById(id);
  const resolveDriver = (id: string): Driver => driverOverrides.get(id) ?? driverById(id);

  const classes = new Map(regulations.classes.map((c) => [c.id, c]));
  // Resolved the same way the race resolves it, so both sessions of a weekend
  // agree about the conditions without either being told.
  const weather: WeatherState = config.startingWeather ?? rollStartingWeather(track, seed);
  const allowed = suitableCompounds(weather).filter((c) =>
    regulations.tyreRules.allowedCompounds.includes(c),
  );
  const softest: CompoundId = allowed[0] ?? 'medium';

  const laps: QualifyingLap[] = [];
  const eliminatedAt = new Map<CarId, number>();
  const plans = new Map<CarId, QualifyingRun>();
  const allocations = new Map<CarId, TyreAllocation>(
    entries.map((entry) => [entry.carId, allocationFor(regulations)]),
  );

  let segment = 0;
  let runners: CarId[] = entries.map((e) => e.carId);

  function surfaceMsAt(slot: number): number {
    if (slots <= 1) return 0;
    return -EVOLUTION_MS * (slot / (slots - 1));
  }

  function yellowChanceAt(slot: number): number {
    const lateness = slots > 1 ? slot / (slots - 1) : 0;
    return YELLOW_EARLY + YELLOW_LATE * lateness;
  }

  function trafficMsFor(carsInSlot: number): number {
    const others = Math.max(0, carsInSlot - 1);
    return others * TRAFFIC_MS_PER_CAR * (0.5 + track.overtakingDifficulty);
  }

  /**
   * Where a team aims to run.
   *
   * Everyone would rather go late on a rubbered-in track, so the good teams
   * time it best while the rest bunch up around them — which is exactly what
   * makes the late slots crowded and the choice interesting.
   */
  function planFor(carId: CarId): QualifyingRun {
    const existing = plans.get(carId);
    if (existing) return existing;
    const entry = entries.find((e) => e.carId === carId)!;
    const team = resolveTeam(entry.teamId);
    // Runs are spread across the session rather than all piling into the end:
    // a session where the first half is empty is not a session. The better
    // teams still lean later, where the track is quickest.
    const base = rng.range(0.25, 1);
    const target = (slots - 1) * Math.min(1, base + (team.carPerformance - 0.8) * 0.15);
    const slot = Math.max(0, Math.min(slots - 1, Math.round(target)));
    // A team runs the softest thing it still has; the fastest tyre is only
    // fastest if there is one left in the garage.
    const compound =
      availableCompound(allocations.get(carId)!, softest, allowed) ?? softest;
    return { carId, slot, compound };
  }

  function lapTimeFor(run: QualifyingRun, carsInSlot: number): number {
    const entry = entries.find((e) => e.carId === run.carId)!;
    const carClass = classes.get(entry.classId) ?? regulations.classes[0]!;
    const breakdown = computeLapTime({
      track,
      team: resolveTeam(entry.teamId),
      driver: resolveDriver(entry.driverId),
      carClass,
      compound: COMPOUNDS[run.compound],
      tyreAgeLaps: TYRE_AGE_LAPS,
      fuelKg: QUALIFYING_FUEL_KG,
      paceMode: 'push',
      // A qualifying session is short: the surface is whatever the conditions
      // have already made it, rather than something that evolves during it.
      wetness: WETNESS_FOR[weather],
      trafficMs: trafficMsFor(carsInSlot),
      surfaceMs: surfaceMsAt(run.slot),
      rng: streams.qualifying,
    });
    return breakdown.totalMs;
  }

  function bestTimeIn(carId: CarId, inSegment: number): number | null {
    const times = laps
      .filter((l) => l.carId === carId && l.segment === inSegment && l.timeMs !== null)
      .map((l) => l.timeMs!);
    return times.length > 0 ? Math.min(...times) : null;
  }

  /** Draws up (and remembers) a plan for every car that does not have one. */
  function plansForSegment(): QualifyingRun[] {
    return runners.map((carId) => {
      const plan = planFor(carId);
      plans.set(carId, plan);
      return plan;
    });
  }

  function forecast(): number[] {
    const counts = new Array<number>(slots).fill(0);
    for (const run of plansForSegment()) counts[run.slot] = (counts[run.slot] ?? 0) + 1;
    return counts;
  }

  function runSegment(): QualifyingLap[] {
    if (segment >= segments.length) return [];

    const runs = plansForSegment();
    const perSlot = new Map<number, number>();
    for (const run of runs) perSlot.set(run.slot, (perSlot.get(run.slot) ?? 0) + 1);

    // The flags are more likely late on, when everybody is out and pushing.
    const yellowSlots = new Set<number>();
    for (const slot of [...perSlot.keys()].sort((a, b) => a - b)) {
      if (rng.chance(yellowChanceAt(slot))) yellowSlots.add(slot);
    }

    // A run costs a set, whoever asked for it. A car with none of the compound
    // it wanted goes out on whatever it does have.
    const honoured = runs.map((run) => {
      const allocation = allocations.get(run.carId)!;
      const compound = availableCompound(allocation, run.compound, allowed);
      if (!compound) return run;
      allocations.set(run.carId, takeSet(allocation, compound));
      return { ...run, compound };
    });

    const produced: QualifyingLap[] = honoured.map((run) => {
      const deleted = yellowSlots.has(run.slot);
      const timeMs = deleted ? null : Math.round(lapTimeFor(run, perSlot.get(run.slot) ?? 1));
      return { carId: run.carId, segment, slot: run.slot, compound: run.compound, timeMs, deleted };
    });
    laps.push(...produced);

    const ranked = [...runners].sort((a, b) => {
      const timeA = bestTimeIn(a, segment);
      const timeB = bestTimeIn(b, segment);
      if (timeA === null && timeB === null) return 0;
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      return timeA - timeB;
    });

    const survivors = Math.min(segments[segment]!.survivors, ranked.length);
    for (const carId of ranked.slice(survivors)) eliminatedAt.set(carId, segment);
    runners = ranked.slice(0, survivors);

    plans.clear();
    segment += 1;
    return produced;
  }

  function result(): QualifyingResult {
    const finalSegment = segments.length - 1;

    // Survivors first, in the order the last segment left them, then each
    // group of eliminated cars in reverse order of when they went out.
    const grid: CarId[] = [...runners];
    for (let index = finalSegment; index >= 0; index -= 1) {
      const knocked = [...eliminatedAt.entries()]
        .filter(([, at]) => at === index)
        .map(([carId]) => carId)
        .sort((a, b) => {
          const timeA = bestTimeIn(a, index);
          const timeB = bestTimeIn(b, index);
          if (timeA === null && timeB === null) return 0;
          if (timeA === null) return 1;
          if (timeB === null) return -1;
          return timeA - timeB;
        });
      grid.push(...knocked);
    }

    const startingCompounds = new Map<CarId, CompoundId>();
    if (format === 'knockout') {
      for (const carId of runners) {
        const best = laps
          .filter((l) => l.carId === carId && l.segment === finalSegment && l.timeMs !== null)
          .sort((a, b) => a.timeMs! - b.timeMs!)[0];
        if (best) startingCompounds.set(carId, best.compound);
      }
    }

    return {
      grid,
      laps: [...laps],
      eliminatedAt: new Map(eliminatedAt),
      startingCompounds,
      allocations: new Map([...allocations].map(([carId, a]) => [carId, { ...a }])),
    };
  }

  return {
    state: () => ({
      segment,
      segmentName: segments[Math.min(segment, segments.length - 1)]!.name,
      slots,
      runners: [...runners],
      complete: segment >= segments.length,
    }),
    planRun: (run) => void plans.set(run.carId, run),
    runSegment,
    isComplete: () => segment >= segments.length,
    result,
    surfaceMsAt,
    trafficMsFor,
    forecast,
    yellowChanceAt,
    allocationOf: (carId) => ({ ...(allocations.get(carId) ?? allocationFor(regulations)) }),
    conditions: () => weather,
  };
}

/** Runs a whole session with every car on its engineers' plan. */
export function runQualifying(config: RaceConfig, seed: string): QualifyingResult {
  const session = createQualifying(config, seed);
  while (!session.isComplete()) session.runSegment();
  return session.result();
}
