/**
 * Seeded randomness, split into independent named streams.
 *
 * Why split: with a single shared stream, adding one new random draw anywhere
 * in the simulation shifts every draw that follows it, so a seed saved before
 * the change replays as a completely different race. Independent streams keep
 * a seed meaningful across versions of the engine.
 */

export const STREAM_NAMES = [
  'grid',
  'driverError',
  'mechanical',
  'weather',
  'pitCrew',
  'overtake',
  'incident',
  'strategy',
  'qualifying',
] as const;

export type StreamName = (typeof STREAM_NAMES)[number];

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Normal draw with the given mean and standard deviation. */
  normal(mean: number, sd: number): number;
  /** Uniformly picks one item. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
}

export type Streams = Record<StreamName, Rng>;

/** FNV-1a, used only to turn a seed string into a 32-bit generator state. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and good enough for a race simulation. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spare: number | null = null;

  return {
    next,
    int: (max) => Math.floor(next() * max),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    normal(mean, sd) {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return mean + sd * value;
      }
      // Box-Muller. Both draws are kept so the stream advances predictably.
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      const radius = Math.sqrt(-2 * Math.log(u));
      const angle = 2 * Math.PI * v;
      spare = radius * Math.sin(angle);
      return mean + sd * radius * Math.cos(angle);
    },
    pick(items) {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
  };
}

export function createStreams(seed: string): Streams {
  const streams = {} as Streams;
  for (const name of STREAM_NAMES) {
    streams[name] = makeRng(hashSeed(`${seed}::${name}`));
  }
  return streams;
}
