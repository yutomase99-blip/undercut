import type { LayoutPoint } from '@undercut/engine';

export interface SampledPoint extends LayoutPoint {
  /** Unit vector along the racing line here. */
  tx: number;
  ty: number;
  /** Unit normal, pointing to the outside of the circuit. */
  nx: number;
  ny: number;
  /** How hard the circuit turns here, 0 for a straight. */
  curvature: number;
  /** Distance from the start line, as a share of the lap. */
  fraction: number;
}

export interface TrackGeometry {
  points: SampledPoint[];
  length: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  at(fraction: number): SampledPoint;
}

/**
 * Turns a handful of control points into a circuit with a direction and a
 * width.
 *
 * A track drawn as a bare line only needs positions. A track with kerbs, run-off
 * and a pit lane needs to know which way it is pointing and which side is the
 * outside at every point, so all of that is worked out once here rather than
 * guessed at while drawing.
 */
export function buildTrackGeometry(layout: LayoutPoint[], perSegment = 26): TrackGeometry {
  const raw: LayoutPoint[] = [];
  const count = layout.length;

  for (let i = 0; i < count; i += 1) {
    const p0 = layout[(i - 1 + count) % count]!;
    const p1 = layout[i]!;
    const p2 = layout[(i + 1) % count]!;
    const p3 = layout[(i + 2) % count]!;

    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      raw.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }

  const n = raw.length;
  let length = 0;
  const cumulative: number[] = [0];
  for (let i = 1; i <= n; i += 1) {
    const a = raw[i - 1]!;
    const b = raw[i % n]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
    cumulative.push(length);
  }

  // Which way round the loop goes decides which normal points outwards.
  let signedArea = 0;
  for (let i = 0; i < n; i += 1) {
    const a = raw[i]!;
    const b = raw[(i + 1) % n]!;
    signedArea += a.x * b.y - b.x * a.y;
  }
  const outward = signedArea > 0 ? -1 : 1;

  const points: SampledPoint[] = raw.map((point, i) => {
    const prev = raw[(i - 1 + n) % n]!;
    const next = raw[(i + 1) % n]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;

    // Curvature from how much the tangent swings between neighbours.
    const before = raw[(i - 2 + n) % n]!;
    const after = raw[(i + 2) % n]!;
    const a1 = Math.atan2(point.y - before.y, point.x - before.x);
    const a2 = Math.atan2(after.y - point.y, after.x - point.x);
    let swing = a2 - a1;
    while (swing > Math.PI) swing -= Math.PI * 2;
    while (swing < -Math.PI) swing += Math.PI * 2;

    return {
      x: point.x,
      y: point.y,
      tx,
      ty,
      nx: -ty * outward,
      ny: tx * outward,
      curvature: Math.abs(swing),
      fraction: cumulative[i]! / length,
    };
  });

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  return {
    points,
    length,
    bounds: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    },
    at(fraction: number): SampledPoint {
      const wrapped = ((fraction % 1) + 1) % 1;
      const index = Math.min(points.length - 1, Math.floor(wrapped * points.length));
      return points[index]!;
    },
  };
}

/** The longest run of straight track, where a pit lane and a main grandstand go. */
export function findMainStraight(geometry: TrackGeometry): { start: number; end: number } {
  const { points } = geometry;
  const straight = points.map((p) => p.curvature < 0.06);

  let bestStart = 0;
  let bestLength = 0;
  let runStart = -1;

  for (let i = 0; i < points.length * 2; i += 1) {
    const index = i % points.length;
    if (straight[index]) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLength = i - runStart;
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }

  if (bestLength === 0) return { start: 0, end: 0.12 };
  return {
    start: (bestStart % points.length) / points.length,
    end: ((bestStart + bestLength) % points.length) / points.length,
  };
}
