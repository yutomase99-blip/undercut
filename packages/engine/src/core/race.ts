import type {
  CarClass,
  CarId,
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
import { driverById, teamById } from '../content/grid.ts';
import { createStreams, type Streams } from '../rng/streams.ts';
import { computeLapTime, PACE_FUEL_FACTOR, PACE_WEAR_FACTOR } from './lapTime.ts';
import { tyreConditionPct } from './tyres.ts';
import { overtakeChance } from './overtake.ts';
import { pitStopMs, totalPitLossMs } from './pit.ts';
import { stepWeather } from './weather.ts';
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
  /** Where the car started. Breaks ties before anyone has set a lap time. */
  gridPosition: number;
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
    errorMs: 0,
    totalMs,
  };
}

export function createRace(config: RaceConfig, seed: string): Race {
  const streams: Streams = createStreams(seed);
  const track = config.track;
  const regulations = config.regulations;
  const totalLaps = resolveTotalLaps(config);
  const startingFuelKg = track.fuelPerLapKg * totalLaps * 1.03;

  const classes = new Map(regulations.classes.map((c) => [c.id, c]));

  const cars: CarRuntime[] = config.entries.map((entry) => {
    const team = teamById(entry.teamId);
    const driver = driverById(entry.driverId);
    const carClass = classes.get(entry.classId) ?? regulations.classes[0];
    if (!carClass) throw new Error('Regulations declare no classes');
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
      compound: entry.startingCompound,
      tyreAgeLaps: 0,
      tyreConditionPct: 100,
      fuelKg: startingFuelKg,
      paceMode: 'hold',
      pitStops: 0,
      compoundsUsed: [entry.startingCompound],
      retired: false,
      retiredCause: null,
      gapToLeaderMs: 0,
      gapAheadMs: 0,
      lastBreakdown: null,
      team,
      driver,
      carClass,
      pendingPit: null,
      plannedStintLaps: plannedStint(entry.startingCompound, track.tyreWearFactor, streams.strategy),
      manualPace: false,
      reactionLaps: streams.strategy.chance(team.pitCrewSkill * 0.55) ? 0 : 1 + streams.strategy.int(2),
      paceEmaMs: 0,
      gridPosition: 0,
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
      (1 - car.team.carPerformance) * 2100 +
        (1 - car.driver.skill) * 1100 +
        streams.grid.normal(0, 260),
    ]),
  );
  const gridOrder = [...cars].sort(
    (a, b) => qualifyingTimes.get(a.id)! - qualifyingTimes.get(b.id)!,
  );
  let order: CarId[] = gridOrder.map((c) => c.id);
  gridOrder.forEach((car, index) => {
    car.position = index + 1;
    car.gridPosition = index + 1;
  });

  const byId = new Map(cars.map((car) => [car.id, car]));
  const events: RaceEvent[] = [
    { lap: 0, type: 'raceStart', weather: config.startingWeather },
  ];

  let lap = 0;
  let weather: WeatherState = config.startingWeather;
  let caution: CautionPhase = 'none';
  let cautionLapsRemaining = 0;
  let finished = false;
  let weatherChangedAtLap = 0;
  /** Who passed whom and when, so a beaten car does not instantly fight back. */
  const lastPassedBy = new Map<CarId, { by: CarId; lap: number }>();

  const running = () => order.map((id) => byId.get(id)!).filter((car) => !car.retired);

  function refreshOrder(): void {
    // Grid position breaks the tie: before the first lap every car is on zero,
    // and a stable sort would otherwise fall back to entry order and quietly
    // throw away the entire qualifying result.
    const live = cars
      .filter((c) => !c.retired)
      .sort((a, b) => a.raceTimeMs - b.raceTimeMs || a.gridPosition - b.gridPosition);
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
  }

  function deployCaution(): void {
    if (caution === 'deployed') return;
    caution = 'deployed';
    cautionLapsRemaining = 3 + streams.incident.int(3);
    events.push({ lap, type: 'caution', phase: 'deployed' });
  }

  function runStrategy(): void {
    for (const car of running()) {
      if (car.id === config.playerCarId) continue;
      const decision = decideStrategy({
        compound: car.compound,
        tyreAgeLaps: car.tyreAgeLaps,
        tyreConditionPct: car.tyreConditionPct,
        pitStops: car.pitStops,
        compoundsUsed: car.compoundsUsed,
        gapAheadMs: car.gapAheadMs,
        lapsRemaining: totalLaps - car.lapsCompleted,
        plannedStintLaps: car.plannedStintLaps,
        weather,
        lapsSinceWeatherChange: lap - weatherChangedAtLap,
        reactionLaps: car.reactionLaps,
        cautionDeployed: caution === 'deployed',
        wearFactor: track.tyreWearFactor,
        regulations,
        rng: streams.strategy,
      });
      if (decision.pitCompound && car.pendingPit === null) car.pendingPit = decision.pitCompound;
      if (!car.manualPace) car.paceMode = decision.paceMode;
    }
  }

  function rollAttrition(): void {
    for (const car of running()) {
      const cause = rollRetirement(
        car.team,
        car.driver,
        weather,
        car.paceMode,
        streams.mechanical,
        streams.incident,
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

    const nextWeather = stepWeather(weather, track.weatherVolatility, streams.weather);
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

    const field = running();
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
          trafficMs: 0,
          rng: streams.driverError,
        });
      }

      let total = breakdown.totalMs;
      if (car.pendingPit) {
        const stationaryMs = pitStopMs(car.team, streams.pitCrew);
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
      if (car.fuelKg < 1.5 && car.paceMode !== 'save') {
        car.paceMode = 'save';
        car.manualPace = false;
        events.push({
          lap,
          type: 'radio',
          car: car.id,
          message: `${car.driver.name}, we are critical on fuel. Save, save.`,
        });
      }

      if (car.pendingPit) {
        car.compound = car.pendingPit;
        car.compoundsUsed.push(car.pendingPit);
        car.tyreAgeLaps = 0;
        car.pitStops += 1;
        car.pendingPit = null;
        car.plannedStintLaps = plannedStint(car.compound, track.tyreWearFactor, streams.strategy);
      }

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
      const live = running();
      const leader = live[0];
      if (leader) {
        live.forEach((car, index) => {
          car.raceTimeMs = leader.raceTimeMs + index * COMPRESSED_GAP_MS;
        });
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

    if (lap >= totalLaps) {
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

    return [...finishers, ...retired].map((car, index) => {
      const penaltyMs = penaltyFor(car);
      return {
        position: index + 1,
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
    return {
      lap,
      totalLaps,
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
