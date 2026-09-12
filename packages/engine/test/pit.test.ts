import { describe, expect, it } from 'vitest';
import { TEAMS } from '../src/content/grid.ts';
import { trackById } from '../src/content/tracks.ts';
import { MIN_STATIONARY_MS, pitStopMs, totalPitLossMs } from '../src/core/pit.ts';
import { createStreams } from '../src/rng/streams.ts';

const track = trackById('aurora-bay');
const bestCrew = TEAMS[0]!;
const worstCrew = TEAMS[TEAMS.length - 1]!;

function meanStop(team: typeof bestCrew, seed: string, n = 4000): number {
  const rng = createStreams(seed).pitCrew;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += pitStopMs(team, rng);
  return total / n;
}

describe('pit stops', () => {
  it('is quicker on average with a better crew', () => {
    expect(meanStop(bestCrew, 'crew')).toBeLessThan(meanStop(worstCrew, 'crew'));
  });

  it('never returns a physically impossible stop', () => {
    const rng = createStreams('floor').pitCrew;
    for (let i = 0; i < 5000; i += 1) {
      expect(pitStopMs(bestCrew, rng)).toBeGreaterThanOrEqual(MIN_STATIONARY_MS);
    }
  });

  it('occasionally botches a stop', () => {
    const rng = createStreams('botch').pitCrew;
    const stops = Array.from({ length: 5000 }, () => pitStopMs(bestCrew, rng));
    const median = [...stops].sort((a, b) => a - b)[Math.floor(stops.length / 2)]!;
    expect(Math.max(...stops)).toBeGreaterThan(median * 2);
  });

  it('adds the pit lane loss to the stationary time', () => {
    expect(totalPitLossMs(track, 2500)).toBe(track.pitLaneLossMs + 2500);
  });
});
