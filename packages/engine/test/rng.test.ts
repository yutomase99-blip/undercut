import { describe, expect, it } from 'vitest';
import { createStreams, STREAM_NAMES } from '../src/rng/streams.ts';

describe('seeded rng streams', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createStreams('hello');
    const b = createStreams('hello');
    const drawA = Array.from({ length: 20 }, () => a.driverError.next());
    const drawB = Array.from({ length: 20 }, () => b.driverError.next());
    expect(drawA).toEqual(drawB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createStreams('hello');
    const b = createStreams('world');
    expect(a.driverError.next()).not.toEqual(b.driverError.next());
  });

  it('gives every stream an independent sequence', () => {
    const s = createStreams('same-seed');
    expect(s.driverError.next()).not.toEqual(s.mechanical.next());
  });

  it('keeps one stream unaffected by draws from another', () => {
    const untouched = createStreams('isolation');
    const expected = untouched.weather.next();

    const disturbed = createStreams('isolation');
    for (let i = 0; i < 50; i += 1) disturbed.driverError.next();
    expect(disturbed.weather.next()).toBe(expected);
  });

  it('exposes every declared stream', () => {
    const s = createStreams('coverage');
    for (const name of STREAM_NAMES) {
      expect(typeof s[name].next()).toBe('number');
    }
  });

  it('stays inside the unit interval', () => {
    const s = createStreams('bounds');
    for (let i = 0; i < 1000; i += 1) {
      const v = s.overtake.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('draws integers inside the requested range', () => {
    const s = createStreams('ints');
    for (let i = 0; i < 500; i += 1) {
      const v = s.incident.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('produces a normal draw with roughly the requested mean', () => {
    const s = createStreams('normal');
    let total = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) total += s.pitCrew.normal(100, 10);
    expect(Math.abs(total / n - 100)).toBeLessThan(1);
  });
});
