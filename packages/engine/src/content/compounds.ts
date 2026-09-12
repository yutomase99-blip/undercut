import type { Compound, CompoundId } from '../types.ts';

/**
 * Compound envelopes. Softer rubber is faster and dies sooner; the cliff is
 * what forces a strategic decision rather than a arithmetic one.
 */
export const COMPOUNDS: Record<CompoundId, Compound> = {
  soft: {
    id: 'soft',
    label: 'Soft',
    baseOffsetMs: 0,
    warmupLaps: 1,
    degPerLapMs: 85,
    cliffLap: 14,
    cliffFactor: 3.2,
    weatherPenaltyMs: { dry: 0, damp: 4200, wet: 22000 },
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    baseOffsetMs: 550,
    warmupLaps: 2,
    degPerLapMs: 52,
    cliffLap: 24,
    cliffFactor: 3.0,
    weatherPenaltyMs: { dry: 0, damp: 3900, wet: 21000 },
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    baseOffsetMs: 1150,
    warmupLaps: 4,
    degPerLapMs: 31,
    cliffLap: 36,
    cliffFactor: 2.6,
    weatherPenaltyMs: { dry: 0, damp: 3600, wet: 20000 },
  },
  intermediate: {
    id: 'intermediate',
    label: 'Intermediate',
    baseOffsetMs: 5200,
    warmupLaps: 1,
    degPerLapMs: 70,
    cliffLap: 22,
    cliffFactor: 2.4,
    weatherPenaltyMs: { dry: 6500, damp: 0, wet: 5200 },
  },
  wet: {
    id: 'wet',
    label: 'Wet',
    baseOffsetMs: 9800,
    warmupLaps: 1,
    degPerLapMs: 58,
    cliffLap: 26,
    cliffFactor: 2.2,
    weatherPenaltyMs: { dry: 14000, damp: 4300, wet: 0 },
  },
};

export const DRY_COMPOUNDS: CompoundId[] = ['soft', 'medium', 'hard'];
