import type {
  CarClass,
  CarId,
  DriverId,
  CarState,
  CautionPhase,
  Classification,
  Command,
  CompoundId,
  Driver,
  LapBreakdown,
  RaceConfig,
  RaceEvent,
  RaceResult,
  RaceState,
  Team,
  WeatherState,
} from '../types.ts';
import { COMPOUNDS } from '../content/compounds.ts';
import {
  allocationFor,
  availableCompound,
  takeSet,
  type TyreAllocation,
} from './allocation.ts';
import { driverById, teamById } from '../content/grid.ts';
import { createStreams, type Streams } from '../rng/streams.ts';
import { computeLapTime, PACE_FUEL_FACTOR, PACE_WEAR_FACTOR } from './lapTime.ts';
import { tyreConditionPct, tyreFailureChance } from './tyres.ts';
import { overtakeChance } from './overtake.ts';
import { pitStopMs, totalPitLossMs } from './pit.ts';
import { suitableCompounds } from './weather.ts';
import { fuelFactorFor, overtakeShiftFor, suggestedDownforce, tyreLoadFor } from './setup.ts';
import {
  FORECAST_HORIZON,
  forecastAccuracy,
  forecastFrom,
  forecastLookaheadFor,
  forecastTrustFor,
  rollStartingWeather,
  rollWeatherTimeline,
  stepWetness,
  WETNESS_FOR,
  type ForecastEntry,
} from './weather.ts';
import { cautionFollows, rollRetirement } from './incidents.ts';
import {
  LIMIT_WARNINGS_ALLOWED,
  PENALTY_SECONDS,
  trackLimitChance,
  unsafeReleaseChance,
} from './penalties.ts';
import { decideStrategy, plannedStint } from '../ai/strategist.ts';

/** Closest two cars will run. Nobody drives through anybody. */
export const MIN_GAP_MS = 700;
/** Time the defending car loses in the moment it is passed. */
const PASS_COST_MS = 260;
/** Extra tyre age from a lap spent in dirty air, at its worst. */
const DIRTY_AIR_WEAR = 0.35;
/** How far back a car still feels the wake of the one ahead. */
const DIRTY_AIR_ZONE_MS = 1300;
/** Time lost per lap sitting right in that wake. */
const DIRTY_AIR_MAX_MS = 320;
/** Momentum lost in a move that does not come off. */
const FAILED_ATTEMPT_COST_MS = 380;
/**
 * Sustained pace advantage a car needs before it genuinely attacks.
 *
 * This is measured against a rolling average, not a single lap. Gating on one
 * lap means a car that happens to find four tenths through noise launches a
 * move, which produced roughly one attack per car every five laps — nothing
 * like real racing.
 */
const ATTEMPT_THRESHOLD_MS = 150;
/** Weight of the newest lap in a car's rolling pace estimate. */
const PACE_EMA_ALPHA = 0.35;
/** Laps a freshly passed car spends unable to immediately re-pass the same rival. */
const REPASS_COOLDOWN_LAPS = 2;
/** Lap time multiplier while the caution is out. */
const SAFETY_CAR_FACTOR = 1.4;
/** Gap the field is bunched to behind the safety car. */
const COMPRESSED_GAP_MS = 900;
/** Space between cars on the starting grid, as time. */
const GRID_SPACING_MS = 320;
/** Time lost limping back to the pits on a failed tyre. */
const TYRE_FAILURE_LOSS_MS = 22_000;
/** Added to a car that finishes without serving a mandatory compound change. */
export const MANDATORY_PENALTY_MS = 30_000;
/** Time to put one kilogram of fuel in, where refuelling is allowed. */
const REFUEL_MS_PER_KG = 480;
/** Time a driver change adds to a stop, over and above the fuel. */
const DRIVER_CHANGE_MS = 12_000;
/**
 * Time a car loses per lap for each slower car circulating.
 *
 * Multi-class traffic is modelled statistically rather than encounter by
 * encounter: the leaders lose a couple of tenths a lap threading through the
 * slower classes, which is what makes a clean run through traffic worth
 * something without simulating every single pass.
 */
const LAPPED_TRAFFIC_MS_PER_CAR = 12;

interface CarRuntime extends CarState {
  /** How far round the race this car is, in laps. The truth about position. */
  distance: number;
  /**
   * Where this car's own start line is.
   *
   * A car starting tenth begins behind the one starting ninth, so its distance
   * starts negative — and counting laps straight off `Math.floor(distance)`
   * handed every car but the pole-sitter a phantom lap the moment it crossed
   * zero. Laps are counted from where each car actually started.
   */
  startDistance: number;
  /** What it is capable of on the lap it is currently running. */
  paceMs: number;
  /** Standing in the pit box until this moment on the clock. */
  pitUntilMs: number | null;
  lapStartedAtMs: number;
  pittedThisLap: boolean;
  finishedAtMs: number | null;
  team: Team;
  driver: Driver;
  carClass: CarClass;
  pendingPit: CompoundId | null;
  plannedStintLaps: number;
  manualPace: boolean;
  /** How long this pit wall dithers before reacting to a change in conditions. */
  reactionLaps: number;
  /** Rolling average of clean lap times, used to judge real pace. */
  paceEmaMs: number;
  /**
   * This car's own nerve about acting on a forecast, either side of its team's.
   *
   * Team-level thresholds alone are too coarse: confidence in a change only
   * takes a handful of distinct values as it approaches, so twenty cars reach
   * their decision on the same two laps. A per-car bias spreads the thresholds
   * continuously, and somebody is always the one who gambles on staying out.
   */
  forecastTrust: number;
  /** Where the car started. Breaks ties before anyone has set a lap time. */
  gridPosition: number;
  /** The crew, in the order they take over. */
  roster: DriverId[];
  rosterIndex: number;
  /** Tank size, where the regulations allow refuelling. */
  fuelCapacityKg: number;
  /** Sets left in the garage. */
  allocation: TyreAllocation;
  /** How late this pit wall leaves a compulsory stop. */
  mandatoryMarginLaps: number;
}

export interface Race {
  readonly config: RaceConfig;
  state(): RaceState;
  /** Advances the race by one lap at the front, and returns what happened. */
  tick(): RaceEvent[];
  /**
   * Advances the race by a slice of its own time.
   *
   * This is how a race is watched: the interface asks for the milliseconds that
   * have passed and gets back everything that happened in them.
   */
  advance(raceMs: number): RaceEvent[];
  /** Race time elapsed. */
  clock(): number;
  issue(command: Command): void;
  isFinished(): boolean;
  result(): RaceResult;
  events(): readonly RaceEvent[];
  /** What a car still has in the garage. */
  allocationOf(carId: CarId): TyreAllocation;
  /** What your pit wall believes the weather is about to do. */
  forecast(horizon?: number): ForecastEntry[];
  /** What a particular team's pit wall believes. Every team reads it differently. */
  forecastFor(teamId: string, horizon?: number): ForecastEntry[];
}

function resolveTotalLaps(config: RaceConfig): number {
  const length = config.regulations.raceLength;
  if (length.kind === 'laps') return length.laps;
  // Duration-limited racing (endurance) is converted to a lap count up front so
  // that the loop below stays identical for every ruleset.
  const estimatedLapMs = config.track.baseLapMs * 1.08;
  return Math.max(1, Math.round((length.seconds * 1000) / estimatedLapMs));
}

function emptyBreakdown(totalMs: number): LapBreakdown {
  return {
    baseMs: totalMs,
    classMs: 0,
    carMs: 0,
    driverMs: 0,
    tyreMs: 0,
    fuelMs: 0,
    trafficMs: 0,
    paceMs: 0,
    surfaceMs: 0,
    setupMs: 0,
    errorMs: 0,
    totalMs,
  };
}

export function createRace(config: RaceConfig, seed: string): Race {
  const streams: Streams = createStreams(seed);
  const track = config.track;
  const regulations = config.regulations;
  const totalLaps = resolveTotalLaps(config);
  const durationMs =
    regulations.raceLength.kind === 'duration' ? regulations.raceLength.seconds * 1000 : null;

  // Resolved before anything else: the tyres a car is fitted with at the start
  // depend on it, and so does the first event announced.
  const startingWeather: WeatherState =
    config.startingWeather ?? rollStartingWeather(track, seed);

  const classes = new Map(regulations.classes.map((c) => [c.id, c]));

  // Per-race roster wins over the registered content, so a developed car races
  // as it is today without anything being written back to the catalogue.
  const teamOverrides = new Map((config.roster?.teams ?? []).map((t) => [t.id, t]));
  const driverOverrides = new Map((config.roster?.drivers ?? []).map((d) => [d.id, d]));
  const resolveTeam = (id: string) => teamOverrides.get(id) ?? teamById(id);
  const resolveDriver = (id: string) => driverOverrides.get(id) ?? driverById(id);

  const cars: CarRuntime[] = config.entries.map((entry) => {
    const team = resolveTeam(entry.teamId);
    const driver = resolveDriver(entry.driverId);
    const carClass = classes.get(entry.classId) ?? regulations.classes[0];
    if (!carClass) throw new Error('Regulations declare no classes');
    const roster = entry.driverIds && entry.driverIds.length > 0 ? entry.driverIds : [entry.driverId];

    // Nobody starts a wet race on slicks. A car not tied to a qualifying tyre
    // keeps whatever it was entered on, unless the conditions make that absurd.
    const allocation = config.tyreSets?.get(entry.carId)
      ? ({ ...(config.tyreSets.get(entry.carId) as TyreAllocation) })
      : allocationFor(regulations);
    const suitable = suitableCompounds(startingWeather).filter((c) =>
      regulations.tyreRules.allowedCompounds.includes(c),
    );
    const startingCompound = suitable.includes(entry.startingCompound)
      ? entry.startingCompound
      : (availableCompound(allocation, suitable[0] ?? entry.startingCompound, suitable) ??
        entry.startingCompound);
    // Where refuelling is allowed the car carries a tank, not a whole race.
    const fuelCapacityKg = carClass.fuelCapacityKg ?? track.fuelPerLapKg * totalLaps * 1.03;
    const startingFuelKg = regulations.refuelling
      ? fuelCapacityKg
      // Enough to finish with a little in hand: pushing burns more, and running
      // a car dry on the last lap through no decision of the player's is not a
      // strategy game, it is a trap.
      : track.fuelPerLapKg * totalLaps * 1.08;
    return {
      id: entry.carId,
      teamId: entry.teamId,
      driverId: entry.driverId,
      classId: carClass.id,
      position: 0,
      lapsCompleted: 0,
      raceTimeMs: 0,
      lastLapMs: 0,
      bestLapMs: Number.POSITIVE_INFINITY,
      compound: startingCompound,
      // A car runs the setup it was entered on, or the one its engineers
      // arrived at for this circuit.
      downforce: entry.downforce ?? suggestedDownforce(track, team, seed),
      tyreAgeLaps: 0,
      tyreConditionPct: 100,
      fuelKg: startingFuelKg,
      paceMode: 'hold',
      pitStops: 0,
      compoundsUsed: [startingCompound],
      retired: false,
      retiredCause: null,
      gapToLeaderMs: 0,
      gapAheadMs: 0,
      lastBreakdown: null,
      team,
      driver,
      carClass,
      pendingPit: null,
      plannedStintLaps: plannedStint(startingCompound, track.tyreWearFactor, streams.strategy),
      manualPace: false,
      // Now that the well-run teams can see rain coming and move early, the ones
      // reacting to it should take longer to get organised — otherwise the early
      // movers and the reactors all arrive in the pit lane together.
      reactionLaps: streams.strategy.chance(team.pitCrewSkill * 0.3) ? 0 : 1 + streams.strategy.int(3),
      forecastTrust: forecastTrustFor(team) + streams.strategy.range(-0.14, 0.14),
      mandatoryMarginLaps: 3 + streams.strategy.int(7),
      distance: 0,
      inPit: false,
      startDistance: 0,
      paceMs: track.baseLapMs,
      pitUntilMs: null,
      lapStartedAtMs: 0,
      pittedThisLap: false,
      finishedAtMs: null,
      paceEmaMs: 0,
      gridPosition: 0,
      // The set the car starts the race on comes out of the same garage.
      allocation: takeSet(allocation, startingCompound),
      classPosition: 0,
      stintSeconds: 0,
      driversUsed: [entry.driverId],
      finished: false,
      penaltySeconds: 0,
      trackLimitWarnings: 0,
      roster,
      rosterIndex: 0,
      fuelCapacityKg,
    };
  });

  // Qualifying is abstracted to a single representative lap: car, driver, and a
  // little scatter. It only decides the grid, so the detail is not worth it.
  //
  // Each car's lap is drawn ONCE and then sorted. Drawing inside the comparator
  // makes the comparison inconsistent, and a sort with an inconsistent
  // comparator drifts back toward its input order — which silently handed pole
  // to whichever team happened to be first in the list.
  const qualifyingTimes = new Map<CarId, number>(
    cars.map((car) => [
      car.id,
      car.carClass.performanceOffsetMs +
        (1 - car.team.carPerformance) * 2100 +
        (1 - car.driver.skill) * 1100 +
        streams.grid.normal(0, 260),
    ]),
  );
  // A grid set by a real qualifying session wins over the abstracted lap. Any
  // car missing from it lines up behind those that are on it.
  const gridOrder = config.startingGrid
    ? [
        ...config.startingGrid
          .map((id) => cars.find((car) => car.id === id))
          .filter((car): car is CarRuntime => car !== undefined),
        ...cars.filter((car) => !config.startingGrid!.includes(car.id)),
      ]
    : [...cars].sort((a, b) => qualifyingTimes.get(a.id)! - qualifyingTimes.get(b.id)!);
  let order: CarId[] = gridOrder.map((c) => c.id);
  gridOrder.forEach((car, index) => {
    car.position = index + 1;
    car.gridPosition = index + 1;
    // The grid is a place on the road, not a tiebreak: a car starting tenth is
    // genuinely behind the car starting ninth before anybody moves.
    car.distance = -index * (GRID_SPACING_MS / track.baseLapMs);
    car.startDistance = car.distance;
  });

  const byId = new Map(cars.map((car) => [car.id, car]));

  const events: RaceEvent[] = [{ lap: 0, atMs: 0, type: 'raceStart', weather: startingWeather }];

  let lap = 0;
  let weather: WeatherState = startingWeather;
  let wetness = WETNESS_FOR[startingWeather];
  let caution: CautionPhase = 'none';
  let cautionLapsRemaining = 0;
  let finished = false;
  let weatherChangedAtLap = 0;
  // The weather for the whole race is decided now, so that a forecast has a
  // real future to be more or less right about. One extra entry covers the
  // final lap without leaving a forecast dangling past the flag.
  const weatherTimeline = rollWeatherTimeline(
    startingWeather,
    totalLaps + 1,
    track.weatherVolatility,
    streams.weather,
  );
  /** Who passed whom and when, so a beaten car does not instantly fight back. */
  const lastPassedBy = new Map<CarId, { by: CarId; lap: number }>();

  const running = () => order.map((id) => byId.get(id)!).filter((car) => !car.retired);
  /** Cars still circulating: not retired, and not yet across the finish. */
  const active = () => running().filter((car) => !car.finished);

  function refreshOrder(): void {
    // Laps first, then elapsed time. In a race limited by the clock the field
    // does not all cover the same distance, so time alone would rank a lapped
    // GT ahead of the car that passed it.
    //
    // Grid position breaks the remaining tie: before the first lap every car is
    // on zero, and a stable sort would otherwise fall back to entry order and
    // quietly throw away the entire qualifying result.
    // Distance is the whole truth about who is ahead: it counts the part of a
    // lap a car has covered, which is exactly what a lap count throws away.
    const live = cars
      .filter((c) => !c.retired)
      .sort((a, b) => b.distance - a.distance || a.gridPosition - b.gridPosition);
    const out = cars
      .filter((c) => c.retired)
      .sort((a, b) => b.lapsCompleted - a.lapsCompleted || a.raceTimeMs - b.raceTimeMs);

    order = live.map((c) => c.id);
    const leader = live[0];
    live.forEach((car, index) => {
      car.position = index + 1;
      car.gapToLeaderMs = leader ? (leader.distance - car.distance) * car.paceMs : 0;
      const ahead = live[index - 1];
      car.gapAheadMs = ahead ? (ahead.distance - car.distance) * car.paceMs : 0;
    });
    out.forEach((car, index) => {
      car.position = live.length + index + 1;
    });

    // Class positions are what an endurance entrant actually races for.
    const seenPerClass = new Map<string, number>();
    for (const car of [...live, ...out]) {
      const next = (seenPerClass.get(car.classId) ?? 0) + 1;
      seenPerClass.set(car.classId, next);
      car.classPosition = next;
    }
  }

  function deployCaution(): void {
    if (caution === 'deployed') return;
    caution = 'deployed';
    cautionLapsRemaining = 3 + streams.incident.int(3);
    events.push({ lap, atMs: Math.round(clockMs), type: 'caution', phase: 'deployed' });

    // The field closes up behind the safety car, and every strategy built on a
    // comfortable gap is suddenly worthless. Whole laps of a deficit survive:
    // a caution closes gaps, it does not un-lap anybody.
    const bunched = onRoad();
    const leader = bunched[0];
    if (leader) {
      const seenAtDeficit = new Map<number, number>();
      for (const car of bunched) {
        const behind = Math.max(0, leader.distance - car.distance);
        const lapsDown = Math.floor(behind);
        const queue = (seenAtDeficit.get(lapsDown) ?? 0) + 1;
        seenAtDeficit.set(lapsDown, queue);
        car.distance = leader.distance - lapsDown - (queue * COMPRESSED_GAP_MS) / car.paceMs;
      }
    }

    for (const car of active()) refreshPace(car);
  }

  /**
   * Every team forecasts for itself.
   *
   * One shared forecast would put all twenty cars in the pit lane on the same
   * lap the moment rain was called — the failure the reaction delay was added
   * to stop. Seeding each team's doubt separately means they disagree, commit
   * at different moments, and some of them are wrong.
   */
  function teamForecast(teamId: string, horizon = FORECAST_HORIZON): ForecastEntry[] {
    const team = resolveTeam(teamId);
    return forecastFrom(
      weatherTimeline,
      lap,
      `${seed}:${teamId}`,
      horizon,
      forecastAccuracy(team),
    );
  }

  function playerTeamId(): string {
    const entry = config.entries.find((e) => e.carId === config.playerCarId);
    return entry?.teamId ?? config.entries[0]?.teamId ?? '';
  }

  function runStrategy(): void {
    for (const car of active()) {
      if (car.id === config.playerCarId) continue;
      const decision = decideStrategy({
        compound: car.compound,
        tyreAgeLaps: car.tyreAgeLaps,
        tyreConditionPct: car.tyreConditionPct,
        pitStops: car.pitStops,
        compoundsUsed: car.compoundsUsed,
        gapAheadMs: car.gapAheadMs,
        // In a race against the clock, "laps remaining" is a projection from
        // the time left rather than a subtraction from a schedule.
        lapsRemaining:
          durationMs !== null
            ? Math.max(
                0,
                Math.ceil(
                  (durationMs - car.raceTimeMs) / Math.max(1, car.lastLapMs || track.baseLapMs),
                ),
              )
            : totalLaps - car.lapsCompleted,
        plannedStintLaps: car.plannedStintLaps,
        weather,
        lapsSinceWeatherChange: lap - weatherChangedAtLap,
        reactionLaps: car.reactionLaps,
        cautionDeployed: caution === 'deployed',
        wearFactor: track.tyreWearFactor,
        fuelKg: car.fuelKg,
        fuelPerLapKg: track.fuelPerLapKg,
        stintSeconds: car.stintSeconds,
        maxStintSeconds: regulations.stints.maxDriverStintSeconds,
        lap,
        forecast: teamForecast(car.teamId),
        forecastLookahead: forecastLookaheadFor(car.team),
        forecastTrust: car.forecastTrust,
        available: (Object.keys(car.allocation) as CompoundId[]).filter(
          (compound) => car.allocation[compound] > 0,
        ),
        mandatoryMarginLaps: car.mandatoryMarginLaps,
        regulations,
        rng: streams.strategy,
      });
      if (decision.pitCompound && car.pendingPit === null) car.pendingPit = decision.pitCompound;
      if (!car.manualPace) car.paceMode = decision.paceMode;
    }
  }

  /* ------------------------------------------------------------------ *
   * The race runs on a clock, not on laps.
   *
   * A lap used to be the smallest thing that happened: positions, gaps,
   * overtakes, incidents and pit stops were all decided at once and the
   * interface smoothed the result afterwards. Nothing could be watched, because
   * nothing happened in between.
   *
   * Cars now carry a distance that grows continuously. Pace is still settled a
   * lap at a time — that is where tyres, fuel and strategy live — but where a
   * car *is* changes every step, passes happen at the places on the circuit
   * where passing happens, and a stop is a car standing still for as long as
   * the stop takes.
   * ------------------------------------------------------------------ */

  /** Simulated time per step. Small enough to watch, large enough to be cheap. */
  const STEP_MS = 500;
  /** Where on a lap a move can actually be made. */
  const PASSING_ZONES = [0.22, 0.54, 0.86];
  /** Time gap under which a car is in the wake of the one ahead. */
  const DIRTY_AIR_GAP_MS = DIRTY_AIR_ZONE_MS;

  let clockMs = 0;

  /** The gap, in seconds of race time, between a car and the one ahead of it. */
  function gapBetween(car: CarRuntime, ahead: CarRuntime): number {
    return (ahead.distance - car.distance) * car.paceMs;
  }

  /** A car's pace right now, including whatever it is stuck behind. */
  function effectivePaceMs(car: CarRuntime, ahead: CarRuntime | undefined): number {
    let pace = car.paceMs;
    if (ahead) {
      const gapMs = gapBetween(car, ahead);
      if (gapMs > 0 && gapMs < DIRTY_AIR_GAP_MS) {
        const closeness = 1 - gapMs / DIRTY_AIR_GAP_MS;
        pace += DIRTY_AIR_MAX_MS * closeness;
      }
    }
    return Math.max(1, pace);
  }

  /** Settles what a car is capable of for the lap it is starting. */
  function refreshPace(car: CarRuntime): void {
    if (caution === 'deployed') {
      car.paceMs = track.baseLapMs * SAFETY_CAR_FACTOR;
      car.lastBreakdown = emptyBreakdown(car.paceMs);
      return;
    }
    const breakdown = computeLapTime({
      track,
      team: car.team,
      driver: car.driver,
      carClass: car.carClass,
      compound: COMPOUNDS[car.compound],
      tyreAgeLaps: car.tyreAgeLaps,
      fuelKg: car.fuelKg,
      paceMode: car.paceMode,
      wetness,
      downforce: car.downforce,
      trafficMs: lappedTrafficMs(car),
      rng: streams.driverError,
    });
    car.lastBreakdown = breakdown;
    car.paceMs = Math.max(1, breakdown.totalMs);
  }

  /** Slower classes to be threaded through, as a time cost per lap. */
  function lappedTrafficMs(car: CarRuntime): number {
    if (regulations.classes.length <= 1) return 0;
    let slower = 0;
    for (const other of cars) {
      if (other.retired || other.finished) continue;
      if (other.carClass.performanceOffsetMs > car.carClass.performanceOffsetMs) slower += 1;
    }
    return slower * LAPPED_TRAFFIC_MS_PER_CAR;
  }

  /** Everything that happens when a car completes a lap. */
  function onLapCompleted(car: CarRuntime): void {
    car.lapsCompleted += 1;
    const lapTimeMs = clockMs - car.lapStartedAtMs;
    car.lapStartedAtMs = clockMs;
    car.lastLapMs = lapTimeMs;
    if (caution !== 'deployed' && !car.pittedThisLap) {
      car.bestLapMs = Math.min(car.bestLapMs, lapTimeMs);
      car.paceEmaMs =
        car.paceEmaMs === 0 ? lapTimeMs : car.paceEmaMs * (1 - PACE_EMA_ALPHA) + lapTimeMs * PACE_EMA_ALPHA;
    }
    car.pittedThisLap = false;

    events.push({
      lap: car.lapsCompleted,
      atMs: Math.round(clockMs),
      type: 'lapCompleted',
      car: car.id,
      lapTimeMs: Math.round(lapTimeMs),
      position: car.position,
    });

    // The pit lane is entered from the lap you have just finished.
    if (car.pendingPit) enterPits(car);
    else refreshPace(car);

    if (durationMs !== null && clockMs >= durationMs) {
      car.finished = true;
      car.finishedAtMs = clockMs;
    } else if (durationMs === null && car.lapsCompleted >= totalLaps) {
      car.finished = true;
      car.finishedAtMs = clockMs;
      // A lap-limited race is over when the leader crosses. Everyone else is
      // classified on the lap they are on, rather than carrying on alone.
      for (const other of cars) {
        if (other.retired || other.finished) continue;
        const behind = car.distance - other.distance;
        other.finished = true;
        other.finishedAtMs = clockMs + behind * other.paceMs;
        // Anyone on the lead lap still runs to the flag and is credited with
        // the distance, the way a classification actually reads.
        if (behind < 1) other.lapsCompleted = car.lapsCompleted;
      }
    }
  }

  /** Puts a car in the pit lane for as long as the stop actually takes. */
  function enterPits(car: CarRuntime): void {
    const fitted = availableCompound(
      car.allocation,
      car.pendingPit!,
      regulations.tyreRules.allowedCompounds,
    );
    if (!fitted) {
      car.pendingPit = null;
      refreshPace(car);
      return;
    }
    car.pendingPit = fitted;

    let stationaryMs = pitStopMs(car.team, streams.pitCrew);
    if (regulations.refuelling) {
      stationaryMs += Math.max(0, car.fuelCapacityKg - car.fuelKg) * REFUEL_MS_PER_KG;
    }
    if (car.roster.length > 1) stationaryMs += DRIVER_CHANGE_MS;

    car.pitUntilMs = clockMs + totalPitLossMs(track, stationaryMs);
    car.pittedThisLap = true;

    events.push({
      lap: car.lapsCompleted,
      atMs: Math.round(clockMs),
      type: 'pitStop',
      car: car.id,
      compound: fitted,
      stationaryMs: Math.round(stationaryMs),
    });
    events.push({
      lap: car.lapsCompleted,
      atMs: Math.round(clockMs),
      type: 'radio',
      car: car.id,
      message: `Box, box. ${COMPOUNDS[fitted].label} for ${car.driver.name}.`,
    });

    if (streams.pitCrew.chance(unsafeReleaseChance(car.team))) {
      car.penaltySeconds += PENALTY_SECONDS;
      events.push({
        lap: car.lapsCompleted,
        atMs: Math.round(clockMs),
        type: 'penalty',
        car: car.id,
        reason: 'unsafeRelease',
        seconds: PENALTY_SECONDS,
      });
    }
  }

  /** Bolts on what the car came in for and sends it back out. */
  function leavePits(car: CarRuntime): void {
    const compound = car.pendingPit;
    car.pitUntilMs = null;
    car.pendingPit = null;
    if (!compound) {
      refreshPace(car);
      return;
    }

    car.compound = compound;
    car.allocation = takeSet(car.allocation, compound);
    car.compoundsUsed.push(compound);
    car.tyreAgeLaps = 0;
    car.pitStops += 1;
    car.plannedStintLaps = plannedStint(compound, track.tyreWearFactor, streams.strategy);
    if (regulations.refuelling) car.fuelKg = car.fuelCapacityKg;

    if (car.roster.length > 1) {
      const from = car.driverId;
      car.rosterIndex = (car.rosterIndex + 1) % car.roster.length;
      const to = car.roster[car.rosterIndex]!;
      car.driverId = to;
      car.driver = resolveDriver(to);
      car.driversUsed.push(to);
      car.stintSeconds = 0;
      events.push({ lap: car.lapsCompleted, atMs: Math.round(clockMs), type: 'driverChange', car: car.id, from, to });
      events.push({
        lap: car.lapsCompleted,
        atMs: Math.round(clockMs),
        type: 'radio',
        car: car.id,
        message: `${car.driver.name} takes over.`,
      });
    }

    refreshPace(car);
  }

  /** Keeps cars from driving through one another, and lets them try not to. */
  function resolveProximity(stepMs: number): void {
    const field = onRoad();

    for (let index = 1; index < field.length; index += 1) {
      const car = field[index]!;
      const ahead = field[index - 1]!;
      const gapMs = gapBetween(car, ahead);
      if (gapMs >= MIN_GAP_MS) continue;

      // Close enough to try. A move can only be made where the circuit allows
      // one, so the chance is taken at the passing zones rather than wherever
      // the simulation happened to look.
      const inZone = crossedPassingZone(car, stepMs);
      // Capability in clear air, not the lap times actually being set.
      //
      // Observed pace cannot answer this: cars held nose to tail all lap the
      // same time, so a train makes everyone look equally quick and nobody ever
      // has a reason to try. A whole field would lock into grid order and a
      // Hypercar would spend an hour behind an LMP2 that was four seconds a lap
      // slower.
      const sustained = ahead.paceMs - car.paceMs;
      const beaten = lastPassedBy.get(car.id);
      const onCooldown =
        beaten !== undefined && beaten.by === ahead.id && car.lapsCompleted - beaten.lap < REPASS_COOLDOWN_LAPS;

      if (
        inZone &&
        caution !== 'deployed' &&
        sustained >= ATTEMPT_THRESHOLD_MS &&
        !onCooldown
      ) {
        const chance = overtakeChance({
          paceAdvantageMs: Math.max(sustained, MIN_GAP_MS - gapMs) + overtakeShiftFor(car.downforce, ahead.downforce),
          attackerAggression: car.driver.aggression,
          defenderSkill: ahead.driver.skill,
          trackDifficulty: track.overtakingDifficulty,
          classDifferentialBonusMs:
            car.carClass.id === ahead.carClass.id ? 0 : regulations.overtaking.classDifferentialBonusMs,
          drsZones: regulations.overtaking.drsZones,
        });
        const success = streams.overtake.chance(chance);
        events.push({
          lap: car.lapsCompleted + 1,
          atMs: Math.round(clockMs),
          type: 'overtake',
          car: car.id,
          victim: ahead.id,
          success,
        });
        if (success) {
          // Through. The pass is worth the width of a car, and costs the
          // defender a moment.
          const swap = ahead.distance + 0.0004;
          ahead.distance -= (PASS_COST_MS / ahead.paceMs) * 0.5;
          car.distance = swap;
          lastPassedBy.set(ahead.id, { by: car.id, lap: ahead.lapsCompleted });
          continue;
        }
        // The move did not stick: back out, lose the momentum, try again.
        car.tyreAgeLaps += DIRTY_AIR_WEAR * 0.25;
        car.distance -= FAILED_ATTEMPT_COST_MS / car.paceMs;
      }

      // No way past: hold station behind.
      car.distance = ahead.distance - MIN_GAP_MS / car.paceMs;
    }
  }

  /** True when this step took the car through one of the circuit's passing places. */
  function crossedPassingZone(car: CarRuntime, stepMs: number): boolean {
    const travelled = stepMs / car.paceMs;
    const from = car.distance - travelled;
    for (const zone of PASSING_ZONES) {
      const previous = Math.floor(from) + zone;
      const next = Math.floor(car.distance) + zone;
      if ((from < previous && car.distance >= previous) || (from < next && car.distance >= next)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Laps are read off the road, never counted as they are driven.
   *
   * Holding station behind another car moves you back, and a pass moves you
   * forward; both can carry a car over the line without it having driven there,
   * or back over one it has already crossed. Counting at the moment of movement
   * meant distance and lap count drifted apart until a car on thirty laps was
   * classified sixth behind one on twenty-eight.
   */
  function countLaps(): void {
    for (const car of cars) {
      if (car.retired || car.finished) continue;
      const crossed = Math.floor(car.distance - car.startDistance);
      while (car.lapsCompleted < crossed && !car.finished) onLapCompleted(car);
    }
  }

  /** Cars on the road right now, leader first. Rebuilt once per step. */
  function onRoad(): CarRuntime[] {
    const field: CarRuntime[] = [];
    for (const car of cars) {
      if (car.retired || car.finished || car.pitUntilMs !== null) continue;
      field.push(car);
    }
    return field.sort((a, b) => b.distance - a.distance);
  }

  /** One slice of race time. */
  function step(stepMs: number): void {
    clockMs += stepMs;

    // The order of the road is settled once and reused. Working it out per car
    // turned one sort into four hundred, and a two second test suite into a
    // ninety second one.
    const roadBefore = onRoad();
    const aheadOf = new Map<CarId, CarRuntime>();
    for (let i = 1; i < roadBefore.length; i += 1) {
      aheadOf.set(roadBefore[i]!.id, roadBefore[i - 1]!);
    }

    for (const car of cars) {
      if (car.retired || car.finished) continue;
      if (car.pitUntilMs !== null) {
        car.raceTimeMs = clockMs;
        if (clockMs >= car.pitUntilMs) leavePits(car);
        continue;
      }

      const ahead = aheadOf.get(car.id);
      const pace = effectivePaceMs(car, ahead);
      const covered = stepMs / pace;
      const before = car.distance;
      car.distance += covered;
      car.raceTimeMs = clockMs;
      car.stintSeconds += stepMs / 1000;

      const wearMultiplier =
        (caution === 'deployed' ? 0.3 : PACE_WEAR_FACTOR[car.paceMode]) *
        tyreLoadFor(car.downforce) *
        (car.team.tyreWear ?? 1);
      car.tyreAgeLaps += covered * wearMultiplier;

      const fuelMultiplier =
        (caution === 'deployed' ? 0.6 : PACE_FUEL_FACTOR[car.paceMode]) * fuelFactorFor(car.downforce);
      car.fuelKg = Math.max(0, car.fuelKg - track.fuelPerLapKg * covered * fuelMultiplier);

      // Condition is read off the age every step. It used to be recalculated in
      // the block that ended a lap, and when that block went so did this: the
      // wear bar sat at 100% for an entire race and the pit wall was never told
      // its tyres were finished.
      car.tyreConditionPct = tyreConditionPct(
        COMPOUNDS[car.compound],
        car.tyreAgeLaps,
        track.tyreWearFactor,
      );

      void before;
    }

    resolveProximity(stepMs);
    countLaps();
    rollLiveIncidents(stepMs);
    refreshOrder();
    updateSessionState();
  }

  /** Retirements, tyre failures and the stewards, all scaled to the step. */
  function rollLiveIncidents(stepMs: number): void {
    for (const car of cars) {
      if (car.retired || car.finished || car.pitUntilMs !== null) continue;
      const share = stepMs / Math.max(1, car.paceMs);

      const cause = rollRetirement(
        car.team,
        car.driver,
        weather,
        car.paceMode,
        streams.mechanical,
        streams.incident,
        regulations.attritionScale * share,
      );
      if (cause) {
        car.retired = true;
        car.retiredCause = cause;
        events.push({ lap: car.lapsCompleted + 1, atMs: Math.round(clockMs), type: 'retirement', car: car.id, cause });
        events.push({
          lap: car.lapsCompleted + 1,
          atMs: Math.round(clockMs),
          type: 'radio',
          car: car.id,
          message:
            cause === 'mechanical'
              ? `${car.driver.name}: something let go. I'm stopping.`
              : cause === 'outOfFuel'
                ? `${car.driver.name}: that's it, we're out of fuel.`
                : `${car.driver.name}: I've lost it — I'm in the wall.`,
        });
        if (cautionFollows(regulations.cautions.incidentRatePerLap, streams.incident)) deployCaution();
        continue;
      }

      if (car.fuelKg <= 0) {
        car.retired = true;
        car.retiredCause = 'outOfFuel';
        events.push({ lap: car.lapsCompleted + 1, atMs: Math.round(clockMs), type: 'retirement', car: car.id, cause: 'outOfFuel' });
        continue;
      }

      if (
        streams.mechanical.chance(
          tyreFailureChance(COMPOUNDS[car.compound], car.tyreAgeLaps, track.tyreWearFactor) * share,
        )
      ) {
        car.distance -= TYRE_FAILURE_LOSS_MS / car.paceMs;
        events.push({
          lap: car.lapsCompleted + 1,
          atMs: Math.round(clockMs),
          type: 'tyreFailure',
          car: car.id,
          compound: car.compound,
          ageLaps: Math.round(car.tyreAgeLaps),
        });
        car.pendingPit =
          availableCompound(car.allocation, car.compound, regulations.tyreRules.allowedCompounds) ??
          car.compound;
      }

      if (caution !== 'deployed' && streams.incident.chance(
        trackLimitChance(car.driver, car.paceMode, track.overtakingDifficulty) * share,
      )) {
        car.trackLimitWarnings += 1;
        if (car.trackLimitWarnings <= LIMIT_WARNINGS_ALLOWED) {
          events.push({ lap: car.lapsCompleted + 1, atMs: Math.round(clockMs), type: 'warning', car: car.id, count: car.trackLimitWarnings });
        } else {
          car.penaltySeconds += PENALTY_SECONDS;
          events.push({
            lap: car.lapsCompleted + 1,
            atMs: Math.round(clockMs),
            type: 'penalty',
            car: car.id,
            reason: 'trackLimits',
            seconds: PENALTY_SECONDS,
          });
        }
      }
    }
  }

  /** Weather, cautions and strategy, reconsidered once a lap at the front. */
  function updateSessionState(): void {
    let leaderLap = 0;
    for (const car of cars) {
      if (!car.retired && car.lapsCompleted > leaderLap) leaderLap = car.lapsCompleted;
    }
    if (leaderLap === lap) {
      if (durationMs !== null && clockMs >= durationMs && active().length === 0) endRace();
      else if (durationMs === null && active().length === 0) endRace();
      return;
    }
    lap = leaderLap;

    const nextWeather = weatherTimeline[lap] ?? weather;
    if (nextWeather !== weather) {
      events.push({ lap, atMs: Math.round(clockMs), type: 'weather', from: weather, to: nextWeather });
      weather = nextWeather;
      weatherChangedAtLap = lap;
    }
    wetness = stepWetness(wetness, weather);

    if (caution === 'deployed') {
      cautionLapsRemaining -= 1;
      if (cautionLapsRemaining <= 0) {
        caution = 'none';
        events.push({ lap, atMs: Math.round(clockMs), type: 'caution', phase: 'ending' });
        for (const car of active()) refreshPace(car);
      }
    }

    runStrategy();

    if (active().length === 0) endRace();
  }

  function endRace(): void {
    if (finished) return;
    finished = true;
    const winner = classify()[0];
    if (winner) {
      events.push({ lap, atMs: Math.round(clockMs), type: 'chequeredFlag', winner: winner.carId });
    }
  }

  /** Runs the race forward by a slice of its own time. */
  function advance(raceMs: number): RaceEvent[] {
    if (finished) return [];
    const emittedFrom = events.length;
    let remaining = raceMs;
    while (remaining > 0 && !finished) {
      const slice = Math.min(STEP_MS, remaining);
      step(slice);
      remaining -= slice;
    }
    return events.slice(emittedFrom);
  }

  /**
   * Advances by one lap at the front.
   *
   * Kept because a season simulating a calendar has no use for watching, and
   * because every test written before the clock existed speaks in laps.
   */
  function tick(): RaceEvent[] {
    if (finished) return [];
    const emittedFrom = events.length;
    const startLap = lap;
    let guard = 0;
    while (!finished && lap === startLap && guard < 4000) {
      step(STEP_MS);
      guard += 1;
    }
    return events.slice(emittedFrom);
  }

  function mandatoryUnmet(car: CarRuntime): boolean {
    return (
      regulations.tyreRules.mandatoryCompoundChange && new Set(car.compoundsUsed).size < 2
    );
  }

  function classify(): Classification[] {
    const penaltyFor = (car: CarRuntime) =>
      (!car.retired && mandatoryUnmet(car) ? MANDATORY_PENALTY_MS : 0) +
      car.penaltySeconds * 1000;

    // Distance first, then time. Whoever went furthest has won, and only among
    // cars that went the same distance does the clock decide.
    //
    // Sorting on time alone classified a field of Hypercars that had covered
    // thirty-seven laps behind LMP2s that had covered thirty-five.
    const finishers = cars
      .filter((car) => !car.retired)
      .sort((a, b) => {
        if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
        const aTime = (a.finishedAtMs ?? Number.POSITIVE_INFINITY) + penaltyFor(a);
        const bTime = (b.finishedAtMs ?? Number.POSITIVE_INFINITY) + penaltyFor(b);
        if (aTime !== bTime) return aTime - bTime;
        return b.distance - a.distance;
      });
    const retired = cars
      .filter((car) => car.retired)
      .sort((a, b) => b.lapsCompleted - a.lapsCompleted || a.raceTimeMs - b.raceTimeMs);

    const winner = finishers[0];
    const winnerTime = winner ? (winner.finishedAtMs ?? winner.raceTimeMs) + penaltyFor(winner) : 0;

    const seenPerClass = new Map<string, number>();
    return [...finishers, ...retired].map((car, index) => {
      const penaltyMs = penaltyFor(car);
      const classPosition = (seenPerClass.get(car.classId) ?? 0) + 1;
      seenPerClass.set(car.classId, classPosition);
      return {
        position: index + 1,
        classPosition,
        carId: car.id,
        teamId: car.teamId,
        driverId: car.driverId,
        classId: car.classId,
        lapsCompleted: car.lapsCompleted,
        raceTimeMs: Math.round((car.finishedAtMs ?? car.raceTimeMs) + penaltyMs),
        gapToWinnerMs: car.retired
          ? 0
          : Math.max(
              0,
              Math.round((car.finishedAtMs ?? car.raceTimeMs) + penaltyMs - winnerTime),
            ),
        bestLapMs: Number.isFinite(car.bestLapMs) ? Math.round(car.bestLapMs) : 0,
        pitStops: car.pitStops,
        penaltyMs,
        retired: car.retired,
        retiredCause: car.retiredCause,
      };
    });
  }

  function snapshot(): RaceState {
    const leader = cars.filter((c) => !c.retired).sort((a, b) => b.raceTimeMs - a.raceTimeMs)[0];
    return {
      lap,
      totalLaps,
      elapsedMs: leader ? leader.raceTimeMs : 0,
      durationMs,
      weather,
      wetness,
      caution,
      cautionLapsRemaining,
      finished,
      cars: cars
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((car) => ({ ...car, inPit: car.pitUntilMs !== null }) as CarState),
    };
  }

  refreshOrder();

  return {
    config,
    state: snapshot,
    tick,
    advance,
    clock: () => clockMs,
    isFinished: () => finished,
    events: () => events,
    allocationOf: (carId) => ({
      ...(byId.get(carId)?.allocation ?? allocationFor(regulations)),
    }),
    forecast: (horizon = FORECAST_HORIZON) => teamForecast(playerTeamId(), horizon),
    forecastFor: (teamId, horizon = FORECAST_HORIZON) => teamForecast(teamId, horizon),
    result: () => ({
      trackId: track.id,
      seed,
      totalLaps,
      classification: classify(),
      events: [...events],
    }),
    issue(command: Command) {
      const car = byId.get(command.car);
      if (!car || car.retired) return;
      if (command.type === 'pit') {
        car.pendingPit = command.compound;
      } else {
        car.paceMode = command.mode;
        car.manualPace = true;
      }
    },
  };
}

/** Runs a whole race in one go. Used by the season layer and by balance runs. */
export function simulate(config: RaceConfig, seed: string): RaceResult {
  const race = createRace(config, seed);
  while (!race.isFinished()) race.tick();
  return race.result();
}
