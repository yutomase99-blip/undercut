import type { LayoutPoint } from '@undercut/engine';

export interface MapCar {
  id: string;
  colour: string;
  position: number;
  /** Where the car sits on the lap, 0..1 from the start line. */
  fraction: number;
  isPlayer: boolean;
}

interface SampledPath {
  points: LayoutPoint[];
  cumulative: number[];
  total: number;
}

/**
 * Samples a Catmull-Rom spline through the circuit's control points so the
 * layout reads as a racing line rather than a polygon, and so a car's position
 * can be looked up by distance along the lap.
 */
function samplePath(layout: LayoutPoint[], perSegment = 24): SampledPath {
  const points: LayoutPoint[] = [];
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
      points.push({
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

  const cumulative: number[] = [0];
  for (let i = 1; i <= points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i % points.length]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }

  return { points, cumulative, total: cumulative[cumulative.length - 1]! };
}

export function createTrackMap(canvas: HTMLCanvasElement, layout: LayoutPoint[]) {
  const path = samplePath(layout);
  const ctx = canvas.getContext('2d')!;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function fit(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const xs = path.points.map((p) => p.x);
    const ys = path.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padding = 46;

    scale = Math.min(
      (width - padding * 2) / (maxX - minX),
      (height - padding * 2) / (maxY - minY),
    );
    offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
    offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
  }

  const toScreen = (p: LayoutPoint) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

  function pointAt(fraction: number): LayoutPoint {
    const target = ((fraction % 1) + 1) % 1 * path.total;
    let lo = 0;
    let hi = path.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (path.cumulative[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const index = Math.max(1, lo);
    const before = path.points[(index - 1) % path.points.length]!;
    const after = path.points[index % path.points.length]!;
    const segmentStart = path.cumulative[index - 1]!;
    const segmentLength = path.cumulative[index]! - segmentStart || 1;
    const t = (target - segmentStart) / segmentLength;
    return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
  }

  function tracePath(): void {
    ctx.beginPath();
    const first = toScreen(path.points[0]!);
    ctx.moveTo(first.x, first.y);
    for (const point of path.points.slice(1)) {
      const screen = toScreen(point);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.closePath();
  }

  function render(cars: MapCar[]): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    tracePath();
    ctx.strokeStyle = '#222c3c';
    ctx.lineWidth = 17;
    ctx.stroke();

    tracePath();
    ctx.strokeStyle = '#39465c';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Start line, so the lap has an origin the eye can find.
    const start = toScreen(pointAt(0));
    const justAfter = toScreen(pointAt(0.004));
    const angle = Math.atan2(justAfter.y - start.y, justAfter.x - start.x) + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(start.x + Math.cos(angle) * 9, start.y + Math.sin(angle) * 9);
    ctx.lineTo(start.x - Math.cos(angle) * 9, start.y - Math.sin(angle) * 9);
    ctx.strokeStyle = '#e6ebf2';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cars are drawn back to front so the leader is never hidden by traffic.
    for (const car of [...cars].sort((a, b) => b.position - a.position)) {
      const screen = toScreen(pointAt(car.fraction));
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, car.isPlayer ? 9 : 7.5, 0, Math.PI * 2);
      ctx.fillStyle = car.colour;
      ctx.fill();
      if (car.isPlayer) {
        ctx.strokeStyle = '#e6ebf2';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = '#0b0e13';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(car.position), screen.x, screen.y + 0.5);
    }
  }

  fit();
  window.addEventListener('resize', fit);
  return { render, fit };
}
