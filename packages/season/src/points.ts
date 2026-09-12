import type { Classification } from '@undercut/engine';

/** Points for the top ten finishers, as published. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/**
 * Points scored by each car in a race, keyed by car.
 *
 * Scoring is per class, so a class win pays the same as an overall one. In a
 * single-class championship the two are the same thing, which is why there is
 * no branch here for the sprint format.
 */
export function awardPoints(classification: readonly Classification[]): Map<string, number> {
  const awarded = new Map<string, number>();
  for (const car of classification) {
    if (car.retired) continue;
    const points = POINTS[car.classPosition - 1];
    if (points !== undefined) awarded.set(car.carId, points);
  }
  return awarded;
}
