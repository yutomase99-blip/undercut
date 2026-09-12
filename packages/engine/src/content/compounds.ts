import type { Compound, CompoundId } from '../types.ts';

/**
 * Compound envelopes. Softer rubber is faster and dies sooner.
 *
 * The cliff factors are deliberately steep. At three times the normal rate a
 * set past its cliff was slow but perfectly usable, and the answer to "when do
 * I box" could be "eventually". Past the cliff a tyre should be falling away
 * fast enough that staying out is visibly costing you the race.
 */
export const COMPOUNDS: Record<CompoundId, Compound> = {
  soft: {
    id: 'soft',
    label: 'Soft',
    baseOffsetMs: 0,
    warmupLaps: 1,
    degPerLapMs: 85,
    cliffLap: 14,
    cliffFactor: 5.5,
    weatherPenaltyMs: { dry: 0, damp: 4200, wet: 22000 },
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    baseOffsetMs: 550,
    warmupLaps: 2,
    degPerLapMs: 52,
    cliffLap: 24,
    cliffFactor: 5,
    weatherPenaltyMs: { dry: 0, damp: 3900, wet: 21000 },
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    baseOffsetMs: 1150,
    warmupLaps: 4,
    degPerLapMs: 31,
    cliffLap: 36,
    cliffFactor: 4.5,
    weatherPenaltyMs: { dry: 0, damp: 3600, wet: 20000 },
  },
  intermediate: {
    id: 'intermediate',
    label: 'Intermediate',
    baseOffsetMs: 5200,
    warmupLaps: 1,
    degPerLapMs: 70,
    cliffLap: 22,
    cliffFactor: 4.2,
    weatherPenaltyMs: { dry: 6500, damp: 0, wet: 5200 },
  },
  wet: {
    id: 'wet',
    label: 'Wet',
    baseOffsetMs: 9800,
    warmupLaps: 1,
    degPerLapMs: 58,
    cliffLap: 26,
    cliffFactor: 4,
    weatherPenaltyMs: { dry: 14000, damp: 4300, wet: 0 },
  },
};

export const DRY_COMPOUNDS: CompoundId[] = ['soft', 'medium', 'hard'];
