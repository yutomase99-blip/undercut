import type { CompoundId } from '../types.ts';
import type { Regulations } from '../rules/regulations.ts';

/** How many sets of each compound a car has left for the weekend. */
export type TyreAllocation = Record<CompoundId, number>;

export function allocationFor(regulations: Regulations): TyreAllocation {
  return { ...regulations.tyreAllocation };
}

export function countSets(allocation: TyreAllocation, compound: CompoundId): number {
  return allocation[compound] ?? 0;
}

export function hasSet(allocation: TyreAllocation, compound: CompoundId): boolean {
  return countSets(allocation, compound) > 0;
}

/** Hands out a set. Asking for one that does not exist changes nothing. */
export function takeSet(allocation: TyreAllocation, compound: CompoundId): TyreAllocation {
  if (!hasSet(allocation, compound)) return allocation;
  return { ...allocation, [compound]: allocation[compound] - 1 };
}

/**
 * The compound a car would actually fit, given what it has left.
 *
 * A car must always be able to stop, so this falls back through the preferred
 * list and then to anything at all. Only a car with nothing left is stuck, and
 * the allocations are sized so that cannot happen.
 */
export function availableCompound(
  allocation: TyreAllocation,
  preferred: CompoundId,
  fallbacks: readonly CompoundId[],
): CompoundId | null {
  if (hasSet(allocation, preferred)) return preferred;
  for (const compound of fallbacks) {
    if (hasSet(allocation, compound)) return compound;
  }
  const anything = (Object.keys(allocation) as CompoundId[]).find((c) => hasSet(allocation, c));
  return anything ?? null;
}
