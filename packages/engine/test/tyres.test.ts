import { describe, expect, it } from 'vitest';
import { COMPOUNDS } from '../src/content/compounds.ts';
import { tyreConditionPct, tyreDeltaMs } from '../src/core/tyres.ts';

const soft = COMPOUNDS.soft;
const hard = COMPOUNDS.hard;

describe('tyre model', () => {
  it('is slower than peak while the tyre warms up', () => {
    const cold = tyreDeltaMs(hard, 0, 'dry', 1);
    const warm = tyreDeltaMs(hard, hard.warmupLaps, 'dry', 1);
    expect(cold).toBeGreaterThan(warm);
  });

  it('gets slower with age', () => {
    const young = tyreDeltaMs(soft, 4, 'dry', 1);
    const old = tyreDeltaMs(soft, 10, 'dry', 1);
    expect(old).toBeGreaterThan(young);
  });

  it('degrades far faster past the cliff', () => {
    const beforeCliff =
      tyreDeltaMs(soft, soft.cliffLap, 'dry', 1) - tyreDeltaMs(soft, soft.cliffLap - 1, 'dry', 1);
    const afterCliff =
      tyreDeltaMs(soft, soft.cliffLap + 3, 'dry', 1) - tyreDeltaMs(soft, soft.cliffLap + 2, 'dry', 1);
    expect(afterCliff).toBeGreaterThan(beforeCliff * 2);
  });

  it('starts faster on the soft than on the hard when both are fresh and warm', () => {
    expect(tyreDeltaMs(soft, 2, 'dry', 1)).toBeLessThan(tyreDeltaMs(hard, 4, 'dry', 1));
  });

  it('lets the hard survive long enough to beat a dead soft', () => {
    expect(tyreDeltaMs(hard, 30, 'dry', 1)).toBeLessThan(tyreDeltaMs(soft, 30, 'dry', 1));
  });

  it('punishes a dry compound in the wet', () => {
    expect(tyreDeltaMs(soft, 3, 'wet', 1)).toBeGreaterThan(tyreDeltaMs(soft, 3, 'dry', 1) + 15000);
  });

  it('punishes a wet compound on a dry track', () => {
    expect(tyreDeltaMs(COMPOUNDS.wet, 3, 'dry', 1)).toBeGreaterThan(tyreDeltaMs(COMPOUNDS.wet, 3, 'wet', 1));
  });

  it('scales degradation by the track wear factor', () => {
    const gentle = tyreDeltaMs(soft, 12, 'dry', 0.8);
    const harsh = tyreDeltaMs(soft, 12, 'dry', 1.4);
    expect(harsh).toBeGreaterThan(gentle);
  });

  it('reports condition falling from 100 to 0 and never below', () => {
    expect(tyreConditionPct(soft, 0, 1)).toBe(100);
    expect(tyreConditionPct(soft, 8, 1)).toBeLessThan(100);
    expect(tyreConditionPct(soft, 8, 1)).toBeGreaterThan(0);
    expect(tyreConditionPct(soft, 400, 1)).toBe(0);
  });
});
