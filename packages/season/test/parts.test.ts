import { describe, expect, it } from 'vitest';
import { teamById, TEAMS } from '@undercut/engine';
import {
  PART_IDS,
  carPerformanceFrom,
  fitPartsFor,
  partCost,
  reliabilityFrom,
  repairPart,
  runWear,
  tyreWearFrom,
  upgradePart,
  type CarParts,
} from '../src/parts.ts';

function freshParts(): CarParts {
  return fitPartsFor(teamById('kestros'));
}

describe('a car made of parts', () => {
  it('has every part fitted', () => {
    const parts = freshParts();
    for (const id of PART_IDS) {
      expect(parts[id].level).toBeGreaterThan(0);
      expect(parts[id].condition).toBe(1);
    }
  });

  it('starts a good team with better parts than a poor one', () => {
    expect(carPerformanceFrom(fitPartsFor(TEAMS[0]!))).toBeGreaterThan(
      carPerformanceFrom(fitPartsFor(TEAMS[TEAMS.length - 1]!)),
    );
  });

  it('reproduces the team it was built from', () => {
    for (const team of TEAMS) {
      expect(carPerformanceFrom(fitPartsFor(team))).toBeCloseTo(team.carPerformance, 2);
    }
  });
});

describe('what each part does', () => {
  it('makes the car quicker when the performance parts are better', () => {
    const parts = freshParts();
    const faster = { ...parts, engine: { ...parts.engine, level: 1 } };
    expect(carPerformanceFrom(faster)).toBeGreaterThan(carPerformanceFrom(parts));
  });

  it('does not make the car quicker for a better gearbox', () => {
    const parts = freshParts();
    const stronger = { ...parts, gearbox: { ...parts.gearbox, level: 1 } };
    expect(carPerformanceFrom(stronger)).toBeCloseTo(carPerformanceFrom(parts), 6);
  });

  it('reads reliability from the gearbox and the engine', () => {
    const parts = freshParts();
    const worn = { ...parts, gearbox: { ...parts.gearbox, condition: 0.2 } };
    expect(reliabilityFrom(worn)).toBeLessThan(reliabilityFrom(parts));
  });

  it('reads tyre wear from the suspension', () => {
    const parts = freshParts();
    const worn = { ...parts, suspension: { ...parts.suspension, condition: 0.2 } };
    expect(tyreWearFrom(worn)).toBeGreaterThan(tyreWearFrom(parts));
  });

  it('makes a worn car slower than a fresh one of the same quality', () => {
    const parts = freshParts();
    const tired = {
      ...parts,
      engine: { ...parts.engine, condition: 0.3 },
      aero: { ...parts.aero, condition: 0.3 },
    };
    expect(carPerformanceFrom(tired)).toBeLessThan(carPerformanceFrom(parts));
  });
});

describe('wear', () => {
  it('wears every part over a race', () => {
    const before = freshParts();
    const after = runWear(before, 1);
    for (const id of PART_IDS) {
      expect(after[id].condition).toBeLessThan(before[id].condition);
    }
  });

  it('wears more over a longer race', () => {
    const short = runWear(freshParts(), 0.5);
    const long = runWear(freshParts(), 2);
    expect(long.engine.condition).toBeLessThan(short.engine.condition);
  });

  it('never wears a part below nothing', () => {
    let parts = freshParts();
    for (let i = 0; i < 100; i += 1) parts = runWear(parts, 2);
    for (const id of PART_IDS) expect(parts[id].condition).toBe(0);
  });
});

describe('the garage', () => {
  it('charges more to upgrade than to repair', () => {
    expect(partCost('engine', 'upgrade')).toBeGreaterThan(partCost('engine', 'repair'));
  });

  it('raises a part when upgraded', () => {
    const parts = freshParts();
    const after = upgradePart(parts, 'engine');
    expect(after.engine.level).toBeGreaterThan(parts.engine.level);
    expect(after.aero.level).toBe(parts.aero.level);
  });

  it('gives a weaker part more from the same upgrade', () => {
    const parts = freshParts();
    const weak = { ...parts, engine: { ...parts.engine, level: 0.5 } };
    const strong = { ...parts, engine: { ...parts.engine, level: 0.95 } };
    expect(upgradePart(weak, 'engine').engine.level - 0.5).toBeGreaterThan(
      upgradePart(strong, 'engine').engine.level - 0.95,
    );
  });

  it('never pushes a part past the top', () => {
    let parts = { ...freshParts(), engine: { id: 'engine' as const, level: 0.99, condition: 1 } };
    for (let i = 0; i < 40; i += 1) parts = upgradePart(parts, 'engine');
    expect(parts.engine.level).toBeLessThanOrEqual(1);
  });

  it('restores condition when repaired, and nothing else', () => {
    const worn = runWear(runWear(freshParts(), 2), 2);
    const fixed = repairPart(worn, 'gearbox');
    expect(fixed.gearbox.condition).toBe(1);
    expect(fixed.gearbox.level).toBe(worn.gearbox.level);
    expect(fixed.engine.condition).toBe(worn.engine.condition);
  });
});
