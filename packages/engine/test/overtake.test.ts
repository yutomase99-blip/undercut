import { describe, expect, it } from 'vitest';
import { overtakeChance } from '../src/core/overtake.ts';

const base = {
  paceAdvantageMs: 500,
  attackerAggression: 0.7,
  defenderSkill: 0.8,
  trackDifficulty: 0.5,
  classDifferentialBonusMs: 0,
  drsZones: 2,
};

describe('overtake chance', () => {
  it('always returns a probability', () => {
    const extremes = [
      { ...base, paceAdvantageMs: -5000 },
      { ...base, paceAdvantageMs: 20000 },
      { ...base, trackDifficulty: 0 },
      { ...base, trackDifficulty: 1 },
    ];
    for (const input of extremes) {
      const p = overtakeChance(input);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('rises with pace advantage', () => {
    expect(overtakeChance({ ...base, paceAdvantageMs: 1200 })).toBeGreaterThan(
      overtakeChance({ ...base, paceAdvantageMs: 200 }),
    );
  });

  it('falls on a harder circuit', () => {
    expect(overtakeChance({ ...base, trackDifficulty: 0.9 })).toBeLessThan(
      overtakeChance({ ...base, trackDifficulty: 0.2 }),
    );
  });

  it('rises with attacker aggression and falls with defender skill', () => {
    expect(overtakeChance({ ...base, attackerAggression: 0.95 })).toBeGreaterThan(
      overtakeChance({ ...base, attackerAggression: 0.3 }),
    );
    expect(overtakeChance({ ...base, defenderSkill: 0.95 })).toBeLessThan(
      overtakeChance({ ...base, defenderSkill: 0.4 }),
    );
  });

  it('is near zero when the car behind is slower', () => {
    expect(overtakeChance({ ...base, paceAdvantageMs: -800 })).toBeLessThan(0.02);
  });

  it('helps a faster class clear slower traffic', () => {
    expect(overtakeChance({ ...base, classDifferentialBonusMs: 4000 })).toBeGreaterThan(
      overtakeChance({ ...base, classDifferentialBonusMs: 0 }),
    );
  });
});
