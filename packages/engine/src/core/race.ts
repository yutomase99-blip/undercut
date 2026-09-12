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
import { tyreConditionPct } from './tyres.ts';
import { overtakeChance } from './overtake.ts';
import { pitStopMs, totalPitLossMs } from './pit.ts';
import { suitableCompounds } from './weather.ts';
import {
  FORECAST_HORIZON,
  forecastAccuracy,
  forecastFrom,
  forecastLookaheadFor,
  forecastTrustFor,
  rollStartingWeather,
  rollWeatherTimeline,
  type ForecastEntry,
} from './weather.ts';
import { cautionFollows, rollRetirement } from './incidents.ts';
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
}

export interface Race {
  readonly config: RaceConfig;
  state(): RaceState;
  /** Advances the race by one lap and returns everything that happened. */
  tick(): RaceEvent[];
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
      paceEmaMs: 0,
      gridPosition: 0,
      // The set the car starts the race on comes out of the same garage.
      allocation: takeSet(allocation, startingCompound),
      classPosition: 0,
      stintSeconds: 0,
      driversUsed: [entry.driverId],
      finished: false,
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
  });

  const byId = new Map(cars.map((car) => [car.id, car]));

  const events: RaceEvent[] = [{ lap: 0, type: 'raceStart', weather: startingWeather }];

  let lap = 0;
  let weather: WeatherState = startingWeather;
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
    const live = cars
      .filter((c) => !c.retired)
      .sort(
        (a, b) =>
          b.lapsCompleted - a.lapsCompleted ||
          a.raceTimeMs - b.raceTimeMs ||
          a.gridPosition - b.gridPosition,
      );
    const out = cars
      .filter((c) => c.retired)
      .sort((a, b) => b.lapsCompleted - a.lapsCompleted || a.raceTimeMs - b.raceTimeMs);

    order = live.map((c) => c.id);
    const leader = live[0];
    live.forEach((car, index) => {
      car.position = index + 1;
      car.gapToLeaderMs = leader ? car.raceTimeMs - leader.raceTimeMs : 0;
      const ahead = live[index - 1];
      car.gapAheadMs = ahead ? car.raceTimeMs - ahead.raceTimeMs : 0;
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
    events.push({ lap, type: 'caution', phase: 'deployed' });
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
        regulations,
        rng: streams.strategy,
      });
      if (decision.pitCompound && car.pendingPit === null) car.pendingPit = decision.pitCompound;
      if (!car.manualPace) car.paceMode = decision.paceMode;
    }
  }

  function rollAttrition(): void {
    for (const car of active()) {
      const cause = rollRetirement(
        car.team,
        car.driver,
        weather,
        car.paceMode,
        streams.mechanical,
        streams.incident,
        regulations.attritionScale,
      );
      if (!cause) continue;
      car.retired = true;
      car.retiredCause = cause;
      events.push({ lap, type: 'retirement', car: car.id, cause });
      events.push({
        lap,
        type: 'radio',
        car: car.id,
        message:
          cause === 'mechanical'
            ? `${car.driver.name}: something let go. I'm stopping.`
            : `${car.driver.name}: I've lost it — I'm in the wall. Sorry, everyone.`,
      });
      if (cautionFollows(regulations.cautions.incidentRatePerLap, streams.incident)) {
        deployCaution();
      }
    }
  }

  function tick(): RaceEvent[] {
    if (finished) return [];
    const emittedFrom = events.length;
    lap += 1;

    const nextWeather = weatherTimeline[lap] ?? weather;
    if (nextWeather !== weather) {
      events.push({ lap, type: 'weather', from: weather, to: nextWeather });
      weather = nextWeather;
      weatherChangedAtLap = lap;
    }

    if (caution === 'deployed') {
      cautionLapsRemaining -= 1;
      if (cautionLapsRemaining <= 0) {
        caution = 'none';
        events.push({ lap, type: 'caution', phase: 'ending' });
      }
    }
    const cautionAtLapStart = caution === 'deployed';

    runStrategy();
    rollAttrition();
    const cautionDeployedThisLap = caution === 'deployed' && !cautionAtLapStart;
    const underCaution = caution === 'deployed';

    const field = active();

    // How much slower traffic each class has to deal with this lap.
    const slowerCarsByClass = new Map<string, number>();
    if (regulations.classes.length > 1) {
      for (const carClass of regulations.classes) {
        slowerCarsByClass.set(
          carClass.id,
          field.filter((c) => c.carClass.performanceOffsetMs > carClass.performanceOffsetMs).length,
        );
      }
    }
    const lappedTrafficMs = (car: CarRuntime) =>
      (slowerCarsByClass.get(car.classId) ?? 0) * LAPPED_TRAFFIC_MS_PER_CAR;

    const rawLapMs = new Map<CarId, number>();
    const provisional = new Map<CarId, number>();
    const extraWear = new Map<CarId, number>();
    const pitLapIds = new Set<CarId>();

    for (const car of field) {
      let breakdown: LapBreakdown;
      if (underCaution) {
        breakdown = emptyBreakdown(track.baseLapMs * SAFETY_CAR_FACTOR);
      } else {
        breakdown = computeLapTime({
          track,
          team: car.team,
          driver: car.driver,
          carClass: car.carClass,
          compound: COMPOUNDS[car.compound],
          tyreAgeLaps: car.tyreAgeLaps,
          fuelKg: car.fuelKg,
          paceMode: car.paceMode,
          weather,
          trafficMs: lappedTrafficMs(car),
          rng: streams.driverError,
        });
      }

      let total = breakdown.totalMs;
      if (car.pendingPit) {
        // You can only bolt on what is in the garage. A call for a set the car
        // has run out of becomes the nearest thing it still has.
        const fitted = availableCompound(
          car.allocation,
          car.pendingPit,
          regulations.tyreRules.allowedCompounds,
        );
        if (fitted && fitted !== car.pendingPit) car.pendingPit = fitted;
        if (!fitted) car.pendingPit = null;
      }

      if (car.pendingPit) {
        let stationaryMs = pitStopMs(car.team, streams.pitCrew);
        if (regulations.refuelling) {
          stationaryMs += Math.max(0, car.fuelCapacityKg - car.fuelKg) * REFUEL_MS_PER_KG;
        }
        if (car.roster.length > 1) stationaryMs += DRIVER_CHANGE_MS;
        total += totalPitLossMs(track, stationaryMs);
        pitLapIds.add(car.id);
        events.push({
          lap,
          type: 'pitStop',
          car: car.id,
          compound: car.pendingPit,
          stationaryMs: Math.round(stationaryMs),
        });
        events.push({
          lap,
          type: 'radio',
          car: car.id,
          message: `Box, box. ${COMPOUNDS[car.pendingPit].label} for ${car.driver.name}.`,
        });
      }

      car.lastBreakdown = breakdown;
      rawLapMs.set(car.id, total);
      provisional.set(car.id, car.raceTimeMs + total);
    }

    // Resolve who actually gets past whom. Walking from the front means a train
    // of cars resolves naturally: the leader is free, everyone else is measured
    // against the car they are actually stuck behind.
    let previousId: CarId | null = null;
    let previousTime = 0;
    for (const car of field) {
      let time = provisional.get(car.id)!;
      if (previousId !== null) {
        const defender = byId.get(previousId)!;

        // Running in another car's wake costs time and eats the tyre. This is
        // what stops the whole field from sitting nose-to-tail and attacking
        // every single lap: to be a threat you must be faster than the wake is
        // expensive, not merely faster.
        const rawGapMs = time - previousTime;
        if (rawGapMs < DIRTY_AIR_ZONE_MS && !underCaution) {
          const closeness = 1 - Math.max(0, rawGapMs) / DIRTY_AIR_ZONE_MS;
          time += DIRTY_AIR_MAX_MS * closeness;
          extraWear.set(car.id, (extraWear.get(car.id) ?? 0) + DIRTY_AIR_WEAR * closeness);
        }

        const minimumTime = previousTime + MIN_GAP_MS;
        if (time < minimumTime) {
          const closingMs = minimumTime - time;
          // Real pace, not a lucky lap: how much quicker this car has actually
          // been running than the one it has caught.
          const sustainedAdvantageMs =
            car.paceEmaMs > 0 && defender.paceEmaMs > 0
              ? defender.paceEmaMs - car.paceEmaMs
              : closingMs;
          const beatenRecently = lastPassedBy.get(car.id);
          const onCooldown =
            beatenRecently !== undefined &&
            beatenRecently.by === defender.id &&
            lap - beatenRecently.lap < REPASS_COOLDOWN_LAPS;

          if (!underCaution && sustainedAdvantageMs >= ATTEMPT_THRESHOLD_MS && !onCooldown) {
            const chance = overtakeChance({
              paceAdvantageMs: Math.max(sustainedAdvantageMs, closingMs),
              attackerAggression: car.driver.aggression,
              defenderSkill: defender.driver.skill,
              trackDifficulty: track.overtakingDifficulty,
              classDifferentialBonusMs:
                car.carClass.id === defender.carClass.id
                  ? 0
                  : regulations.overtaking.classDifferentialBonusMs,
              drsZones: regulations.overtaking.drsZones,
            });
            const success = streams.overtake.chance(chance);
            events.push({ lap, type: 'overtake', car: car.id, victim: defender.id, success });
            if (success) {
              provisional.set(defender.id, provisional.get(defender.id)! + PASS_COST_MS);
              lastPassedBy.set(defender.id, { by: car.id, lap });
            } else {
              // The move did not stick: back out, lose the momentum, try again.
              time = minimumTime + FAILED_ATTEMPT_COST_MS;
            }
          } else {
            time = minimumTime;
          }
        }
      }
      provisional.set(car.id, time);
      previousTime = time;
      previousId = car.id;
    }

    for (const car of field) {
      const raw = rawLapMs.get(car.id)!;
      const finalTime = provisional.get(car.id)!;
      const trafficMs = Math.max(0, finalTime - (car.raceTimeMs + raw));
      const lapTimeMs = raw + trafficMs;

      if (car.lastBreakdown) {
        car.lastBreakdown = {
          ...car.lastBreakdown,
          trafficMs,
          totalMs: car.lastBreakdown.totalMs + trafficMs,
        };
      }

      if (!underCaution && !pitLapIds.has(car.id)) {
        car.paceEmaMs =
          car.paceEmaMs === 0 ? raw : car.paceEmaMs * (1 - PACE_EMA_ALPHA) + raw * PACE_EMA_ALPHA;
      }

      car.raceTimeMs = finalTime;
      car.lastLapMs = lapTimeMs;
      car.lapsCompleted += 1;
      if (!underCaution && !pitLapIds.has(car.id)) {
        car.bestLapMs = Math.min(car.bestLapMs, lapTimeMs);
      }

      const wearMultiplier = underCaution ? 0.3 : PACE_WEAR_FACTOR[car.paceMode];
      car.tyreAgeLaps += wearMultiplier + (extraWear.get(car.id) ?? 0);

      const fuelMultiplier = underCaution ? 0.6 : PACE_FUEL_FACTOR[car.paceMode];
      car.fuelKg = Math.max(0, car.fuelKg - track.fuelPerLapKg * fuelMultiplier);
      if (car.fuelKg < 1.5 && car.paceMode !== 'save' && !car.retired) {
        car.paceMode = 'save';
        car.manualPace = false;
        events.push({
          lap,
          type: 'radio',
          car: car.id,
          message: `${car.driver.name}, we are critical on fuel. Save, save.`,
        });
      }

      // An empty tank ends the race for that car. Without this a pit wall that
      // simply never calls a stop circulates on nothing and wins on strategy it
      // never had to pay for.
      if (car.fuelKg <= 0 && !car.retired) {
        car.retired = true;
        car.retiredCause = 'outOfFuel';
        events.push({ lap, type: 'retirement', car: car.id, cause: 'outOfFuel' });
        events.push({
          lap,
          type: 'radio',
          car: car.id,
          message: `${car.driver.name}: that's it, we're out of fuel. Stopping on track.`,
        });
      }

      car.stintSeconds += lapTimeMs / 1000;

      if (car.pendingPit) {
        car.compound = car.pendingPit;
        car.allocation = takeSet(car.allocation, car.pendingPit);
        car.compoundsUsed.push(car.pendingPit);
        car.tyreAgeLaps = 0;
        car.pitStops += 1;
        car.pendingPit = null;
        car.plannedStintLaps = plannedStint(car.compound, track.tyreWearFactor, streams.strategy);

        if (regulations.refuelling) car.fuelKg = car.fuelCapacityKg;

        // The crew rotates at every stop, which is how a three-driver line-up
        // gets through a long race inside the stint limits.
        if (car.roster.length > 1) {
          const from = car.driverId;
          car.rosterIndex = (car.rosterIndex + 1) % car.roster.length;
          const to = car.roster[car.rosterIndex]!;
          car.driverId = to;
          car.driver = resolveDriver(to);
          car.driversUsed.push(to);
          car.stintSeconds = 0;
          events.push({ lap, type: 'driverChange', car: car.id, from, to });
          events.push({
            lap,
            type: 'radio',
            car: car.id,
            message: `${car.driver.name} takes over.`,
          });
        }
      }

      if (durationMs !== null && car.raceTimeMs >= durationMs) car.finished = true;

      car.tyreConditionPct = tyreConditionPct(
        COMPOUNDS[car.compound],
        car.tyreAgeLaps,
        track.tyreWearFactor,
      );
    }

    refreshOrder();

    if (cautionDeployedThisLap) {
      // The field bunches up behind the safety car, and every strategy built on
      // a comfortable gap is suddenly worthless. This is the drama engine.
      //
      // Only cars still circulating are bunched: a car that has already taken
      // the flag is not on the road to be caught, and rewriting its race time
      // would retroactively change a finished result.
      //
      // A caution closes gaps within a lap; it does not un-lap anybody. So the
      // whole laps of a deficit are preserved and only the remainder is
      // squeezed — otherwise a GT ten minutes down would rejoin on the leader's
      // gearbox, which is not a safety car, it is a time machine.
      const bunched = active();
      const leader = bunched[0];
      const referenceLapMs = leader?.lastLapMs && leader.lastLapMs > 0 ? leader.lastLapMs : track.baseLapMs;
      if (leader) {
        const seenAtDeficit = new Map<number, number>();
        for (const car of bunched) {
          const deficitMs = Math.max(0, car.raceTimeMs - leader.raceTimeMs);
          const lapsDown = Math.floor(deficitMs / referenceLapMs);
          const queue = (seenAtDeficit.get(lapsDown) ?? 0) + 1;
          seenAtDeficit.set(lapsDown, queue);
          car.raceTimeMs = leader.raceTimeMs + lapsDown * referenceLapMs + queue * COMPRESSED_GAP_MS;
        }
        refreshOrder();
      }
    }

    for (const car of running()) {
      events.push({
        lap,
        type: 'lapCompleted',
        car: car.id,
        lapTimeMs: Math.round(car.lastLapMs),
        position: car.position,
      });
    }

    // A lap-limited race ends on a lap count; a clock-limited one ends when
    // every car still going has crossed the line after time expired.
    const over = durationMs !== null ? active().length === 0 : lap >= totalLaps;
    if (over) {
      finished = true;
      const winner = classify()[0];
      if (winner) events.push({ lap, type: 'chequeredFlag', winner: winner.carId });
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
      !car.retired && mandatoryUnmet(car) ? MANDATORY_PENALTY_MS : 0;

    const finishers = cars
      .filter((car) => !car.retired)
      .sort(
        (a, b) =>
          b.lapsCompleted - a.lapsCompleted ||
          a.raceTimeMs + penaltyFor(a) - (b.raceTimeMs + penaltyFor(b)),
      );
    const retired = cars
      .filter((car) => car.retired)
      .sort((a, b) => b.lapsCompleted - a.lapsCompleted || a.raceTimeMs - b.raceTimeMs);

    const winner = finishers[0];
    const winnerTime = winner ? winner.raceTimeMs + penaltyFor(winner) : 0;

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
        raceTimeMs: Math.round(car.raceTimeMs + penaltyMs),
        gapToWinnerMs: car.retired
          ? 0
          : Math.max(0, Math.round(car.raceTimeMs + penaltyMs - winnerTime)),
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
      caution,
      cautionLapsRemaining,
      finished,
      cars: cars
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((car) => ({ ...car }) as CarState),
    };
  }

  refreshOrder();

  return {
    config,
    state: snapshot,
    tick,
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
