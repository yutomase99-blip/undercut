import type { CompoundId, PaceMode, WeatherState } from '../types.ts';
import type { ForecastEntry } from '../core/weather.ts';
import type { Regulations } from '../rules/regulations.ts';
import type { Rng } from '../rng/streams.ts';
import { COMPOUNDS, DRY_COMPOUNDS } from '../content/compounds.ts';
import { suitableCompounds } from '../core/weather.ts';

export interface StrategyView {
  /** The lap just completed. */
  lap: number;
  compound: CompoundId;
  tyreAgeLaps: number;
  tyreConditionPct: number;
  pitStops: number;
  compoundsUsed: CompoundId[];
  gapAheadMs: number;
  lapsRemaining: number;
  plannedStintLaps: number;
  weather: WeatherState;
  /** Laps elapsed since the conditions last changed. */
  lapsSinceWeatherChange: number;
  /** How many laps this pit wall takes to commit to a call. */
  reactionLaps: number;
  cautionDeployed: boolean;
  wearFactor: number;
  /** Fuel aboard, and how much a lap costs. */
  fuelKg: number;
  fuelPerLapKg: number;
  /** Seconds the driver aboard has been at the wheel, and the legal limit. */
  stintSeconds: number;
  maxStintSeconds: number | null;
  /** This team's own reading of the weather to come. */
  forecast: ForecastEntry[];
  /** How many laps ahead this team will commit to a forecast. */
  forecastLookahead: number;
  /** How sure this team insists on being before acting on one. */
  forecastTrust: number;
  /** Compounds this car still has a set of. */
  available: CompoundId[];
  /** How late this pit wall is willing to leave a compulsory stop. */
  mandatoryMarginLaps: number;
  regulations: Regulations;
  rng: Rng;
}

export interface StrategyDecision {
  pitCompound: CompoundId | null;
  paceMode: PaceMode;
}

const MAX_STOPS = 3;
/** Laps of fuel left at which a stop stops being optional. */
const FUEL_RESERVE_LAPS = 2;
/** Share of the legal stint after which the crew brings the car in. */
const STINT_MARGIN = 0.85;


/** Whether a tyre family matches the conditions at all. */
function isWrongFamily(compound: CompoundId, weather: WeatherState): boolean {
  const dry = DRY_COMPOUNDS.includes(compound);
  if (weather === 'dry') return !dry;
  return dry;
}

/** How long the next set should be asked to last, before the cliff bites. */
export function plannedStint(compound: CompoundId, wearFactor: number, rng: Rng): number {
  const spec = COMPOUNDS[compound];
  const target = (spec.cliffLap * rng.range(0.82, 1.12)) / wearFactor;
  return Math.max(6, Math.round(target));
}

/** Picks the next set: something legal, suited to the weather, and ideally new. */
export function chooseCompound(view: StrategyView, forWeather?: WeatherState): CompoundId {
  const weather = forWeather ?? view.weather;
  // Only what is actually in the garage. Planning around a set the car used in
  // qualifying is how a strategy falls apart in the pit lane.
  const inStock = (compounds: CompoundId[]) => {
    const stocked = compounds.filter((c) => view.available.includes(c));
    return stocked.length > 0 ? stocked : compounds;
  };
  const suited = inStock(
    suitableCompounds(weather).filter((c) =>
      view.regulations.tyreRules.allowedCompounds.includes(c),
    ),
  );
  if (weather !== 'dry') return suited[0] ?? 'intermediate';

  const unused = suited.filter((c) => !view.compoundsUsed.includes(c));
  const pool = unused.length > 0 ? unused : suited;

  // A short run to the flag wants grip; a long one wants survival.
  if (view.lapsRemaining <= 14) return pool.includes('soft') ? 'soft' : (pool[0] ?? 'medium');
  if (view.lapsRemaining >= 30) return pool.includes('hard') ? 'hard' : (pool[pool.length - 1] ?? 'hard');
  return pool.includes('medium') ? 'medium' : (pool[0] ?? 'medium');
}

/**
 * The AI pit wall. Deliberately readable rather than clever: every branch is a
 * call a real strategist would recognise, which makes its mistakes legible to
 * the player rather than mysterious.
 */
export function decideStrategy(view: StrategyView): StrategyDecision {
  const mandatoryUnmet =
    view.regulations.tyreRules.mandatoryCompoundChange && new Set(view.compoundsUsed).size < 2;

  let pitCompound: CompoundId | null = null;
  // A refuelling category has no sensible cap on stops: the race length decides
  // how many you make, not a rule of thumb.
  const stopsAllowed = view.regulations.refuelling ? Number.POSITIVE_INFINITY : MAX_STOPS;
  const canStop = view.pitStops < stopsAllowed && view.lapsRemaining > 1;

  const lapsOfFuelLeft = view.fuelPerLapKg > 0 ? view.fuelKg / view.fuelPerLapKg : Infinity;
  const outOfFuelSoon = view.regulations.refuelling && lapsOfFuelLeft <= FUEL_RESERVE_LAPS;
  const stintNearlyUp =
    view.maxStintSeconds !== null && view.stintSeconds >= view.maxStintSeconds * STINT_MARGIN;

  // A change the team both expects soon and believes in. Anything further off
  // than it is willing to commit to, or shakier than it trusts, is noted and
  // ignored.
  // The conditions this pit wall is playing for: what it believes is coming, if
  // it is both confident enough and close enough to act on, otherwise what is
  // outside now.
  const confidentChange =
    view.forecastLookahead > 0
      ? view.forecast.find(
          (entry) =>
            entry.lap - view.lap <= view.forecastLookahead &&
            entry.confidence >= view.forecastTrust &&
            entry.state !== view.weather,
        )
      : undefined;
  const playingFor: WeatherState = confidentChange?.state ?? view.weather;

  const wrongForPlan = isWrongFamily(view.compound, playingFor);
  const wrongForNow = isWrongFamily(view.compound, view.weather);
  // Reacting to weather that has already turned takes a moment to organise, and
  // a slower pit wall takes longer. Moving early for weather you expect does
  // not, because you picked the lap yourself.
  const readyToAct = wrongForNow ? view.lapsSinceWeatherChange >= view.reactionLaps : true;

  if (canStop && (outOfFuelSoon || stintNearlyUp)) {
    // Fuel and the stint clock are not negotiable, so they are checked before
    // anything to do with tyres.
    pitCompound = chooseCompound(view);
  } else if (canStop && wrongForPlan && readyToAct && view.lapsRemaining > 2) {
    // Fit for the conditions being played for. Judging the plan rather than
    // only the present is what stops a car that has just fitted wets for rain
    // it expects from being sent straight back out for dries because the track
    // is, for the moment, still dry.
    pitCompound = chooseCompound(view, playingFor);
  } else if (canStop) {
    if (
      view.cautionDeployed &&
      // Fresh tyres have to have time to pay for themselves. A caution seven
      // laps from the flag is not a free stop, it is a free twenty seconds
      // lost — and judging it against a fixed lap count sent the entire field
      // down the pit lane together whenever a safety car came out late.
      view.lapsRemaining > view.plannedStintLaps * 0.4 &&
      view.tyreAgeLaps > view.plannedStintLaps * 0.3
    ) {
      // A stop under caution costs a fraction of a green-flag stop.
      pitCompound = chooseCompound(view);
    } else if (view.tyreAgeLaps >= view.plannedStintLaps && view.lapsRemaining > 3) {
      pitCompound = chooseCompound(view);
    } else if (mandatoryUnmet && view.lapsRemaining <= view.mandatoryMarginLaps) {
      // Last chance to serve the rule. Better late than disqualified — and
      // every pit wall leaves itself a different amount of room, or the whole
      // field serves it on the same lap.
      pitCompound = chooseCompound(view);
    }
  }

  let paceMode: PaceMode = 'hold';
  if (view.tyreConditionPct < 18) paceMode = 'save';
  else if (view.lapsRemaining <= 5 && view.gapAheadMs < 1500) paceMode = 'push';
  else if (pitCompound !== null) paceMode = 'push';

  return { pitCompound, paceMode };
}
