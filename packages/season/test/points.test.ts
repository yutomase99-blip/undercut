import { describe, expect, it } from 'vitest';
import { POINTS, awardPoints } from '../src/points.ts';
import type { Classification } from '@undercut/engine';

function entry(overrides: Partial<Classification>): Classification {
  return {
    position: 1,
    classPosition: 1,
    carId: 'car',
    teamId: 'team',
    driverId: 'driver',
    classId: 'prototype',
    lapsCompleted: 50,
    raceTimeMs: 1,
    gapToWinnerMs: 0,
    bestLapMs: 1,
    pitStops: 1,
    penaltyMs: 0,
    retired: false,
    retiredCause: null,
    ...overrides,
  };
}

describe('points', () => {
  it('pays the published table down to tenth', () => {
    const field = POINTS.map((_, index) =>
      entry({ position: index + 1, classPosition: index + 1, carId: `c${index}` }),
    );
    const awarded = awardPoints(field);
    POINTS.forEach((value, index) => {
      expect(awarded.get(`c${index}`)).toBe(value);
    });
  });

  it('pays nothing outside the points', () => {
    const field = Array.from({ length: 14 }, (_, index) =>
      entry({ position: index + 1, classPosition: index + 1, carId: `c${index}` }),
    );
    const awarded = awardPoints(field);
    expect(awarded.get('c10')).toBeUndefined();
    expect(awarded.get('c13')).toBeUndefined();
  });

  it('pays a retired car nothing, wherever it is classified', () => {
    const field = [
      entry({ position: 1, classPosition: 1, carId: 'winner' }),
      entry({ position: 2, classPosition: 2, carId: 'dnf', retired: true, retiredCause: 'mechanical' }),
    ];
    const awarded = awardPoints(field);
    expect(awarded.get('winner')).toBe(POINTS[0]);
    expect(awarded.get('dnf')).toBeUndefined();
  });

  it('pays each class separately in a multi-class field', () => {
    const field = [
      entry({ position: 1, classPosition: 1, carId: 'hy1', classId: 'hypercar' }),
      entry({ position: 2, classPosition: 2, carId: 'hy2', classId: 'hypercar' }),
      entry({ position: 3, classPosition: 1, carId: 'gt1', classId: 'gt' }),
      entry({ position: 4, classPosition: 2, carId: 'gt2', classId: 'gt' }),
    ];
    const awarded = awardPoints(field);
    // A class win is a class win: the GT winner scores the same as the overall one.
    expect(awarded.get('hy1')).toBe(POINTS[0]);
    expect(awarded.get('gt1')).toBe(POINTS[0]);
    expect(awarded.get('hy2')).toBe(POINTS[1]);
    expect(awarded.get('gt2')).toBe(POINTS[1]);
  });
});
