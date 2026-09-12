import type { CompoundId, PaceMode, WeatherState } from '../types.ts';
import type { Regulations } from '../rules/regulations.ts';
import type { Rng } from '../rng/streams.ts';
import { COMPOUNDS, DRY_COMPOUNDS } from '../content/compounds.ts';
import { suitableCompounds } from '../core/weather.ts';

export interface StrategyView {
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
  regulations: Regulations;
  rng: Rng;
}

export interface StrategyDecision {
  pitCompound: CompoundId | null;
  paceMode: PaceMode;
}

const MAX_STOPS = 3;

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
export function chooseCompound(view: StrategyView): CompoundId {
  const suited = suitableCompounds(view.weather).filter((c) =>
    view.regulations.tyreRules.allowedCompounds.includes(c),
  );
  if (view.weather !== 'dry') return suited[0] ?? 'intermediate';

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
  const canStop = view.pitStops < MAX_STOPS && view.lapsRemaining > 1;

  if (canStop) {
    if (
      isWrongFamily(view.compound, view.weather) &&
      view.lapsRemaining > 2 &&
      view.lapsSinceWeatherChange >= view.reactionLaps
    ) {
      // Conditions changed under us. Nothing else matters — but a pit wall
      // takes a moment to commit, and a slower one takes longer. Without this
      // delay all twenty cars box on the identical lap, which is not racing.
      pitCompound = chooseCompound(view);
    } else if (view.cautionDeployed && view.lapsRemaining > 6 && view.tyreAgeLaps > 5) {
      // A stop under caution costs a fraction of a green-flag stop.
      pitCompound = chooseCompound(view);
    } else if (view.tyreAgeLaps >= view.plannedStintLaps && view.lapsRemaining > 3) {
      pitCompound = chooseCompound(view);
    } else if (mandatoryUnmet && view.lapsRemaining <= 5) {
      // Last chance to serve the rule. Better late than disqualified.
      pitCompound = chooseCompound(view);
    }
  }

  let paceMode: PaceMode = 'hold';
  if (view.tyreConditionPct < 18) paceMode = 'save';
  else if (view.lapsRemaining <= 5 && view.gapAheadMs < 1500) paceMode = 'push';
  else if (pitCompound !== null) paceMode = 'push';

  return { pitCompound, paceMode };
}
