import { describe, expect, it } from 'vitest';
import { createQualifying, runQualifying } from '../src/core/qualifying.ts';
import { defaultGrid } from '../src/content/grid.ts';
import { enduranceGrid } from '../src/content/enduranceGrid.ts';
import { trackById } from '../src/content/tracks.ts';
import { OPEN_WHEEL, openWheelOverLaps } from '../src/rules/openwheel.ts';
import { ENDURANCE, enduranceOverHours } from '../src/rules/endurance.ts';
import type { RaceConfig } from '../src/types.ts';

function sprint(): RaceConfig {
  return {
    track: trackById('kestrel-park'),
    regulations: openWheelOverLaps(30),
    entries: defaultGrid(),
    startingWeather: 'dry',
  };
}

function endurance(): RaceConfig {
  return {
    track: trackById('vantor-ring'),
    regulations: enduranceOverHours(2),
    entries: enduranceGrid(),
    startingWeather: 'dry',
  };
}

describe('knockout qualifying', () => {
  it('runs every segment the rules declare', () => {
    const session = createQualifying(sprint(), 'q-1');
    let segments = 0;
    while (!session.isComplete()) {
      session.runSegment();
      segments += 1;
    }
    expect(segments).toBe(OPEN_WHEEL.qualifying.segments.length);
  });

  it('eliminates down to the declared survivors', () => {
    const session = createQualifying(sprint(), 'q-2');
    const expected = OPEN_WHEEL.qualifying.segments.map((s) => s.survivors);
    const seen: number[] = [];
    while (!session.isComplete()) {
      session.runSegment();
      seen.push(session.state().runners.length);
    }
    // The last segment does not eliminate anybody; it just sets the order.
    expect(seen.slice(0, -1)).toEqual(expected.slice(0, -1));
  });

  it('puts every car on the grid exactly once', () => {
    const result = runQualifying(sprint(), 'q-3');
    const grid = defaultGrid();
    expect(result.grid).toHaveLength(grid.length);
    expect(new Set(result.grid).size).toBe(grid.length);
  });

  it('orders cars eliminated earlier behind those eliminated later', () => {
    const result = runQualifying(sprint(), 'q-4');
    const positionOf = (carId: string) => result.grid.indexOf(carId);
    for (const [carId, segment] of result.eliminatedAt) {
      for (const [otherId, otherSegment] of result.eliminatedAt) {
        if (segment < otherSegment) {
          expect(positionOf(carId)).toBeGreaterThan(positionOf(otherId));
        }
      }
    }
  });

  it('orders the front of the grid by the final segment', () => {
    const result = runQualifying(sprint(), 'q-5');
    const finalSegment = OPEN_WHEEL.qualifying.segments.length - 1;
    const finalLaps = result.laps
      .filter((l) => l.segment === finalSegment && l.timeMs !== null)
      .sort((a, b) => a.timeMs! - b.timeMs!);
    expect(finalLaps.length).toBeGreaterThan(1);
    expect(result.grid[0]).toBe(finalLaps[0]!.carId);
  });

  it('puts a car that never set a time at the back', () => {
    const result = runQualifying(sprint(), 'q-6');
    const timed = new Set(result.laps.filter((l) => l.timeMs !== null).map((l) => l.carId));
    const untimed = result.grid.filter((carId) => !timed.has(carId));
    for (const carId of untimed) {
      expect(result.grid.indexOf(carId)).toBeGreaterThan(result.grid.length - untimed.length - 1);
    }
  });

  it('generally qualifies the quicker cars further forward', () => {
    // Averaged over many sessions: any single session can throw up a surprise.
    let frontRowFromTopTeams = 0;
    const sessions = 40;
    for (let i = 0; i < sessions; i += 1) {
      const result = runQualifying(sprint(), `q-field-${i}`);
      const poleTeam = result.grid[0]!.split('-')[0];
      if (['meridian', 'arcwright', 'kestros'].includes(poleTeam!)) frontRowFromTopTeams += 1;
    }
    expect(frontRowFromTopTeams / sessions).toBeGreaterThan(0.6);
  });
});

describe('the session itself', () => {
  it('makes the track quicker as the session goes on', () => {
    const session = createQualifying(sprint(), 'q-evolution');
    const early = session.surfaceMsAt(0);
    const late = session.surfaceMsAt(session.state().slots - 1);
    expect(late).toBeLessThan(early);
  });

  it('costs time to run in a crowded window', () => {
    const session = createQualifying(sprint(), 'q-traffic');
    expect(session.trafficMsFor(8)).toBeGreaterThan(session.trafficMsFor(1));
  });

  it('deletes every lap in a slot where the flags come out', () => {
    const result = runQualifying(sprint(), 'q-yellow');
    const deleted = result.laps.filter((l) => l.deleted);
    for (const lap of deleted) {
      expect(lap.timeMs).toBeNull();
      const sameSlot = result.laps.filter(
        (l) => l.segment === lap.segment && l.slot === lap.slot,
      );
      expect(sameSlot.every((l) => l.deleted)).toBe(true);
    }
  });

  it('lets the player choose when to run and on what', () => {
    const session = createQualifying(sprint(), 'q-plan');
    const carId = defaultGrid()[0]!.carId;
    session.planRun({ carId, slot: 3, compound: 'soft' });
    session.runSegment();
    const lap = session.result().laps.find((l) => l.carId === carId && l.segment === 0)!;
    expect(lap.slot).toBe(3);
    expect(lap.compound).toBe('soft');
  });
});

describe('qualifying decides the race', () => {
  it('starts the top ten on the tyre they set their best final time on', () => {
    const result = runQualifying(sprint(), 'q-tyre');
    const finalSegment = OPEN_WHEEL.qualifying.segments.length - 1;
    for (const [carId, compound] of result.startingCompounds) {
      const best = result.laps
        .filter((l) => l.carId === carId && l.segment === finalSegment && l.timeMs !== null)
        .sort((a, b) => a.timeMs! - b.timeMs!)[0];
      expect(best).toBeDefined();
      expect(compound).toBe(best!.compound);
    }
  });

  it('leaves cars that missed the final segment free to choose', () => {
    const result = runQualifying(sprint(), 'q-free');
    for (const carId of result.eliminatedAt.keys()) {
      expect(result.startingCompounds.has(carId)).toBe(false);
    }
  });
});

describe('endurance qualifying', () => {
  it('runs a single session', () => {
    const result = runQualifying(endurance(), 'q-endurance');
    expect(new Set(result.laps.map((l) => l.segment))).toEqual(new Set([0]));
    expect(result.grid).toHaveLength(enduranceGrid().length);
  });

  it('lines the classes up in order of pace', () => {
    const result = runQualifying(endurance(), 'q-endurance-classes');
    const entries = new Map(enduranceGrid().map((e) => [e.carId, e.classId]));
    const classOf = (carId: string) => entries.get(carId)!;

    // Among the cars that set a time. A car whose lap is deleted starts at the
    // back whatever it is, which is the rule rather than a pace order.
    const timed = new Set(
      result.laps.filter((l) => l.timeMs !== null).map((l) => l.carId),
    );
    const order = result.grid.filter((carId) => timed.has(carId)).map(classOf);
    const firstGt = order.indexOf('gt');
    const lastHypercar = order.lastIndexOf('hypercar');
    expect(lastHypercar).toBeLessThan(firstGt);
  });

  it('sends a car whose lap is deleted to the back, whatever class it is', () => {
    const result = runQualifying(endurance(), 'q-endurance-classes');
    const deleted = new Set(result.laps.filter((l) => l.deleted).map((l) => l.carId));
    const timedCount = result.grid.length - deleted.size;
    for (const carId of deleted) {
      expect(result.grid.indexOf(carId)).toBeGreaterThanOrEqual(timedCount);
    }
  });

  it('eliminates nobody', () => {
    const result = runQualifying(endurance(), 'q-endurance-keep');
    expect(result.eliminatedAt.size).toBe(0);
  });

  it('does not tie anyone to a starting tyre', () => {
    expect(ENDURANCE.qualifying.format).toBe('single');
    const result = runQualifying(endurance(), 'q-endurance-tyre');
    expect(result.startingCompounds.size).toBe(0);
  });
});

describe('determinism', () => {
  it('replays a session identically', () => {
    const a = runQualifying(sprint(), 'q-same');
    const b = runQualifying(sprint(), 'q-same');
    expect(a.grid).toEqual(b.grid);
    expect(a.laps).toEqual(b.laps);
  });

  it('gives a different session for a different seed', () => {
    const a = runQualifying(sprint(), 'q-alpha');
    const b = runQualifying(sprint(), 'q-beta');
    expect(a.laps.map((l) => l.timeMs)).not.toEqual(b.laps.map((l) => l.timeMs));
  });
});

describe('the forecast', () => {
  it('accounts for every car due to run', () => {
    const session = createQualifying(sprint(), 'q-forecast');
    const counts = session.forecast();
    expect(counts).toHaveLength(session.state().slots);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(session.state().runners.length);
  });

  it('shows the player’s own choice in the crowding', () => {
    const session = createQualifying(sprint(), 'q-forecast-plan');
    const before = session.forecast();
    const carId = defaultGrid()[0]!.carId;
    const quietSlot = before.indexOf(Math.min(...before));
    session.planRun({ carId, slot: quietSlot, compound: 'soft' });
    const after = session.forecast();
    expect(after[quietSlot]).toBeGreaterThanOrEqual(before[quietSlot]!);
    expect(after.reduce((a, b) => a + b, 0)).toBe(before.reduce((a, b) => a + b, 0));
  });

  it('does not change what the session then does', () => {
    const withPeek = createQualifying(sprint(), 'q-peek');
    withPeek.forecast();
    withPeek.forecast();
    while (!withPeek.isComplete()) withPeek.runSegment();

    const without = createQualifying(sprint(), 'q-peek');
    while (!without.isComplete()) without.runSegment();

    expect(withPeek.result().grid).toEqual(without.result().grid);
  });
});

describe('the risk of going late', () => {
  it('is higher at the end of the session than at the start', () => {
    const session = createQualifying(sprint(), 'q-risk');
    const slots = session.state().slots;
    expect(session.yellowChanceAt(slots - 1)).toBeGreaterThan(session.yellowChanceAt(0) * 3);
  });

  it('spreads runs across the whole session', () => {
    const session = createQualifying(sprint(), 'q-spread');
    const forecast = session.forecast();
    const firstHalf = forecast.slice(0, Math.floor(forecast.length / 2));
    expect(firstHalf.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
