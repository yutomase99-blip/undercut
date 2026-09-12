import type { LayoutPoint } from '@undercut/engine';
import { buildTrackGeometry, findMainStraight, type SampledPoint, type TrackGeometry } from './trackGeometry.ts';

export interface MapCar {
  id: string;
  colour: string;
  position: number;
  /** Where the car sits on the lap, 0..1 from the start line. */
  fraction: number;
  isPlayer: boolean;
  /** Standing in its pit box rather than out on the road. */
  inPit?: boolean;
}

/**
 * Every dimension here is in screen pixels, not circuit units.
 *
 * Circuits are drawn in their own arbitrary coordinates and vary in size, so a
 * width expressed in those units came out five pixels wide on one track and
 * fifteen on another — with cars, drawn in pixels, larger than the road they
 * were on.
 */
const TRACK_HALF_PX = 11;
const RUNOFF_HALF_PX = 19;
const PIT_OFFSET_PX = 30;
const PIT_HALF_PX = 6;
const STAND_OFFSET_PX = 28;
const STAND_DEPTH_PX = 17;
const KERB_WIDTH_PX = 3;

const PALETTE = {
  ground: '#0d1219',
  grass: '#16241c',
  runoff: '#3a3020',
  asphalt: '#32363f',
  asphaltEdge: '#d6dbe4',
  kerbA: '#c4352b',
  kerbB: '#e9edf3',
  pit: '#3a3f4b',
  pitLine: '#f2b705',
  stand: '#232a36',
  standRoof: '#39424f',
  garage: '#2e3542',
  garageRoof: '#4a5364',
  crowd: ['#8892a6', '#c5ccd8', '#5f6b7f', '#e8d9c0', '#9aa7bd'],
};

export function createTrackMap(canvas: HTMLCanvasElement, layout: LayoutPoint[]) {
  const geometry = buildTrackGeometry(layout);
  const straight = findMainStraight(geometry);
  const ctx = canvas.getContext('2d')!;

  /**
   * The circuit is drawn once into its own canvas and blitted underneath the
   * cars every frame. Grandstands and kerbs do not move, and redrawing several
   * thousand of them sixty times a second is a good way to make a race stutter.
   */
  const scene = document.createElement('canvas');
  const sceneCtx = scene.getContext('2d')!;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drawnAt = { width: 0, height: 0 };

  const toScreen = (p: { x: number; y: number }) => ({
    x: p.x * scale + offsetX,
    y: p.y * scale + offsetY,
  });

  /** A point pushed sideways off the racing line, by a distance in pixels. */
  const offset = (p: SampledPoint, pixels: number) => ({
    x: p.x + (p.nx * pixels) / scale,
    y: p.y + (p.ny * pixels) / scale,
  });

  function fit(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    scene.width = width * ratio;
    scene.height = height * ratio;
    sceneCtx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const { minX, maxX, minY, maxY } = geometry.bounds;
    const padding = 58;
    scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
    offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
    offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;

    drawnAt = { width, height };
    drawScene(width, height);
  }

  function traceOffset(target: CanvasRenderingContext2D, distance: number): void {
    target.beginPath();
    geometry.points.forEach((point, index) => {
      const screen = toScreen(offset(point, distance));
      if (index === 0) target.moveTo(screen.x, screen.y);
      else target.lineTo(screen.x, screen.y);
    });
    target.closePath();
  }

  function traceCentre(target: CanvasRenderingContext2D): void {
    target.beginPath();
    geometry.points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index === 0) target.moveTo(screen.x, screen.y);
      else target.lineTo(screen.x, screen.y);
    });
    target.closePath();
  }

  /** Everything that does not move. */
  function drawScene(width: number, height: number): void {
    const g = sceneCtx;
    g.clearRect(0, 0, width, height);

    g.fillStyle = PALETTE.ground;
    g.fillRect(0, 0, width, height);

    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Grass, then gravel, then the road itself: each a wider stroke under the
    // last, which is the cheapest way to build a verge.
    traceCentre(g);
    g.strokeStyle = PALETTE.grass;
    g.lineWidth = (RUNOFF_HALF_PX + 13) * 2;
    g.stroke();

    traceCentre(g);
    g.strokeStyle = PALETTE.runoff;
    g.lineWidth = RUNOFF_HALF_PX * 2;
    g.stroke();

    drawGrandstands(g);
    drawPitLane(g);

    traceCentre(g);
    g.strokeStyle = PALETTE.asphalt;
    g.lineWidth = TRACK_HALF_PX * 2;
    g.stroke();

    drawKerbs(g);

    for (const side of [-1, 1]) {
      traceOffset(g, side * (TRACK_HALF_PX - 1));
      g.strokeStyle = PALETTE.asphaltEdge;
      g.lineWidth = 1;
      g.globalAlpha = 0.5;
      g.stroke();
      g.globalAlpha = 1;
    }

    drawStartLine(g);
  }

  /** Red and white teeth on the inside and outside of every real corner. */
  function drawKerbs(g: CanvasRenderingContext2D): void {
    const points = geometry.points;
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]!;
      if (point.curvature < 0.1) continue;
      const next = points[(i + 1) % points.length]!;

      for (const side of [-1, 1]) {
        const inner = toScreen(offset(point, side * TRACK_HALF_PX));
        const outer = toScreen(offset(point, side * (TRACK_HALF_PX + KERB_WIDTH_PX)));
        const innerNext = toScreen(offset(next, side * TRACK_HALF_PX));
        const outerNext = toScreen(offset(next, side * (TRACK_HALF_PX + KERB_WIDTH_PX)));

        g.beginPath();
        g.moveTo(inner.x, inner.y);
        g.lineTo(outer.x, outer.y);
        g.lineTo(outerNext.x, outerNext.y);
        g.lineTo(innerNext.x, innerNext.y);
        g.closePath();
        g.fillStyle = i % 6 < 3 ? PALETTE.kerbA : PALETTE.kerbB;
        g.fill();
      }
    }
  }

  /** The pit lane runs alongside the main straight, with a box per team. */
  function drawPitLane(g: CanvasRenderingContext2D): void {
    const points = geometry.points;
    const from = Math.floor(straight.start * points.length);
    const to = Math.floor(straight.end * points.length);
    const indices: number[] = [];
    for (let i = from; i !== to; i = (i + 1) % points.length) {
      indices.push(i);
      if (indices.length > points.length) break;
    }
    if (indices.length < 6) return;

    // The lane itself, set back from the track on the inside.
    g.beginPath();
    indices.forEach((index, n) => {
      const screen = toScreen(offset(points[index]!, -PIT_OFFSET_PX));
      if (n === 0) g.moveTo(screen.x, screen.y);
      else g.lineTo(screen.x, screen.y);
    });
    g.strokeStyle = PALETTE.pit;
    g.lineWidth = PIT_HALF_PX * 2;
    g.lineCap = 'butt';
    g.stroke();

    // The white line that separates the lane from the track, and the yellow one
    // down the middle of it, are what make a pit lane read as a pit lane.
    g.strokeStyle = '#e9edf3';
    g.lineWidth = 1.2;
    g.globalAlpha = 0.7;
    g.stroke();
    g.globalAlpha = 1;

    g.beginPath();
    indices.forEach((index, n) => {
      const screen = toScreen(offset(points[index]!, -PIT_OFFSET_PX));
      if (n === 0) g.moveTo(screen.x, screen.y);
      else g.lineTo(screen.x, screen.y);
    });
    g.setLineDash([6, 6]);
    g.strokeStyle = PALETTE.pitLine;
    g.lineWidth = 1.2;
    g.stroke();
    g.setLineDash([]);

    // Garages behind it, one per box, with the numbers on the wall.
    const boxes = Math.min(10, Math.floor(indices.length / 3));
    for (let b = 0; b < boxes; b += 1) {
      const index = indices[Math.floor(((b + 0.5) / boxes) * indices.length)]!;
      const point = points[index]!;
      const near = toScreen(offset(point, -(PIT_OFFSET_PX + PIT_HALF_PX)));
      const far = toScreen(offset(point, -(PIT_OFFSET_PX + PIT_HALF_PX + 12)));
      const angle = Math.atan2(point.ty, point.tx);

      g.save();
      g.translate(near.x, near.y);
      g.rotate(angle);
      const depth = Math.hypot(far.x - near.x, far.y - near.y);
      const boxWidth = Math.max(7, (geometry.length / points.length) * (indices.length / boxes) * scale * 0.5);
      g.fillStyle = PALETTE.garage;
      g.fillRect(-boxWidth / 2, 0, boxWidth, depth);
      g.fillStyle = PALETTE.garageRoof;
      g.fillRect(-boxWidth / 2, depth - 3.5, boxWidth, 3.5);
      // The open front of the box, facing the lane.
      g.fillStyle = '#11151c';
      g.fillRect(-boxWidth / 2 + 1.5, 1, boxWidth - 3, 2.5);
      g.restore();
    }
  }

  /** Stands where there is a straight to watch, packed with people. */
  function drawGrandstands(g: CanvasRenderingContext2D): void {
    const points = geometry.points;
    const spots: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]!;
      if (point.curvature > 0.08) continue;
      // Keep them apart, and off the pit straight where the garages are.
      if (spots.some((other) => Math.abs(other - i) < points.length * 0.12)) continue;
      const fraction = point.fraction;
      const onPitStraight =
        straight.start < straight.end
          ? fraction > straight.start && fraction < straight.end
          : fraction > straight.start || fraction < straight.end;
      if (onPitStraight) continue;
      spots.push(i);
      if (spots.length >= 4) break;
    }

    for (const index of spots) {
      const point = points[index]!;
      const length = Math.round(points.length * 0.055);
      const near = offset(point, STAND_OFFSET_PX);
      const screen = toScreen(near);
      const angle = Math.atan2(point.ty, point.tx);
      const width = length * (geometry.length / points.length) * scale;

      g.save();
      g.translate(screen.x, screen.y);
      g.rotate(angle);

      g.fillStyle = PALETTE.stand;
      g.fillRect(-width / 2, 0, width, STAND_DEPTH_PX);

      // The crowd: rows of small, slightly different people.
      const rows = 5;
      const seats = Math.max(6, Math.floor(width / 4));
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < seats; c += 1) {
          if ((r * seats + c) % 7 === 3) continue;
          const px = -width / 2 + ((c + 0.5) / seats) * width;
          const py = ((r + 0.7) / rows) * STAND_DEPTH_PX;
          g.fillStyle = PALETTE.crowd[(r * 3 + c * 5) % PALETTE.crowd.length]!;
          g.globalAlpha = 0.85;
          g.fillRect(px - 0.9, py - 0.9, 1.8, 1.8);
        }
      }
      g.globalAlpha = 1;

      g.fillStyle = PALETTE.standRoof;
      g.fillRect(-width / 2, STAND_DEPTH_PX - 2.5, width, 2.5);
      g.restore();
    }
  }

  function drawStartLine(g: CanvasRenderingContext2D): void {
    const point = geometry.at(0);
    const centre = toScreen(point);
    const angle = Math.atan2(point.ty, point.tx);
    const width = TRACK_HALF_PX * 2;

    g.save();
    g.translate(centre.x, centre.y);
    g.rotate(angle);

    const squares = 8;
    const square = width / squares;
    for (let i = 0; i < squares; i += 1) {
      for (let row = 0; row < 2; row += 1) {
        g.fillStyle = (i + row) % 2 === 0 ? '#e9edf3' : '#1a1d23';
        g.fillRect(row * square - square, -width / 2 + i * square, square, square);
      }
    }

    // The gantry the lights hang from, which is how you know where the race
    // starts without being told.
    g.fillStyle = '#414a5a';
    g.fillRect(-2, -width / 2 - 7, 4, width + 14);
    g.fillStyle = PALETTE.kerbA;
    for (let i = 0; i < 5; i += 1) {
      g.fillRect(-1.5, -width / 2 - 5 + i * (width / 4.5), 3, 3);
    }
    g.restore();
  }

  /** A car, pointed the way it is going. */
  function drawCar(car: MapCar, point: SampledPoint, sideways: number): void {
    const screen = toScreen(offset(point, sideways));
    const angle = Math.atan2(point.ty, point.tx);
    const size = 6.5;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.18, size * 0.92, size * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // A body with a nose and two wings, which at this size is all a car needs.
    ctx.fillStyle = car.colour;
    ctx.beginPath();
    ctx.moveTo(size * 0.95, 0);
    ctx.lineTo(size * 0.25, size * 0.3);
    ctx.lineTo(-size * 0.75, size * 0.34);
    ctx.lineTo(-size * 0.75, -size * 0.34);
    ctx.lineTo(size * 0.25, -size * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(12,16,22,0.85)';
    ctx.fillRect(size * 0.55, -size * 0.34, size * 0.14, size * 0.68);
    ctx.fillRect(-size * 0.82, -size * 0.46, size * 0.16, size * 0.92);

    if (car.isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.15, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function render(cars: MapCar[]): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    // The panel can change size without the window doing anything — a column
    // settling, a font arriving, a section being hidden. Drawing a scene built
    // for one size into another stretches the circuit into abstract art, so the
    // size is checked rather than trusted.
    if (width !== drawnAt.width || height !== drawnAt.height) fit();

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(scene, 0, 0, width, height);

    // Back of the field first, so the leader is never buried under traffic.
    const ordered = [...cars].sort((a, b) => b.position - a.position);
    for (const car of ordered) {
      const point = geometry.at(car.fraction);
      if (car.inPit) {
        drawCar(car, point, -PIT_OFFSET_PX);
        continue;
      }
      // Cars sit either side of the racing line so a train is legible.
      const lane = (car.position % 2 === 0 ? 1 : -1) * TRACK_HALF_PX * 0.38;
      drawCar(car, point, lane);
    }
  }

  fit();
  window.addEventListener('resize', fit);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => fit()).observe(canvas);
  }
  return { render, fit };
}

export type { TrackGeometry };
