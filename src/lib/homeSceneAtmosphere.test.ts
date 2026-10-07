import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  homeSkyPeriod,
  moonPhaseStage,
  pixelMoonPaths,
  resolveHomeSceneAtmosphere,
  type HomeSkyPeriod,
} from './homeSceneAtmosphere';

describe('decorative local-clock sky periods', () => {
  it.each([
    [0, 'night'], [4.999, 'night'], [5, 'dawn'], [7.999, 'dawn'],
    [8, 'day'], [16.999, 'day'], [17, 'sunset'], [18.999, 'sunset'],
    [19, 'night'], [23.999, 'night'],
  ] as const)('maps local hour %s to %s', (hour, expected) => {
    expect(homeSkyPeriod(hour)).toBe(expected);
  });
});

describe('eight approximate lunar display stages', () => {
  it.each(Array.from({ length: 8 }, (_, stage) => stage))('keeps phase center %s', stage => {
    expect(moonPhaseStage(stage / 8)).toBe(stage);
  });

  it.each(Array.from({ length: 8 }, (_, stage) => stage))('rounds across boundary %s, including the new-moon wrap', stage => {
    const boundary = (2 * stage + 1) / 16;
    expect(moonPhaseStage(boundary - 1e-9)).toBe(stage);
    expect(moonPhaseStage(boundary)).toBe((stage + 1) % 8);
    expect(moonPhaseStage(boundary + 1e-9)).toBe((stage + 1) % 8);
  });

  it('normalizes whole cycles and keeps waxing and waning quarters distinct', () => {
    expect([0, 1, -1, 2, -2].map(moonPhaseStage)).toEqual([0, 0, 0, 0, 0]);
    expect([.25, .75, 1.25, -.25].map(moonPhaseStage)).toEqual([2, 6, 2, 6]);
    expect(moonPhaseStage(1 - 1e-9)).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite phase %s', phase => {
    expect(() => moonPhaseStage(phase)).toThrow(RangeError);
  });
});

// Independent primary-source oracle, not values recomputed by SunCalc in the test.
// USNO dates/times are UT: https://aa.usno.navy.mil/calculated/moon/phases?year=2026
const PRIMARY_PHASES = [
  { instant: '2026-08-12T17:37:00Z', phase: 0, stage: 0, fraction: 0 },
  { instant: '2026-08-20T02:46:00Z', phase: .25, stage: 2, fraction: .5 },
  { instant: '2026-08-28T04:18:00Z', phase: .5, stage: 4, fraction: 1 },
  { instant: '2026-09-04T07:51:00Z', phase: .75, stage: 6, fraction: .5 },
] as const;

describe('instant-based lunar calculation', () => {
  it.each(PRIMARY_PHASES)('matches USNO primary phase at $instant', ({ instant, phase, stage, fraction }) => {
    const result = resolveHomeSceneAtmosphere(new Date(instant));
    const distance = Math.abs(result.moonPhase - phase);
    // The icon is approximate, and illuminated fraction is not exactly .5 at a
    // geocentric quarter. These tolerances remain far narrower than one bucket.
    expect(Math.min(distance, 1 - distance)).toBeLessThan(.002);
    expect(Math.abs(result.illuminatedFraction - fraction)).toBeLessThan(.005);
    expect(result.moonStage).toBe(stage);
  });

  it('treats equivalent offset timestamps as the same instant without mutating the Date', () => {
    const utc = new Date('2026-08-19T17:46:00Z');
    const tokyo = new Date('2026-08-20T02:46:00+09:00');
    const losAngeles = new Date('2026-08-19T10:46:00-07:00');
    const before = utc.getTime();
    expect(resolveHomeSceneAtmosphere(utc)).toEqual(resolveHomeSceneAtmosphere(tokyo));
    expect(resolveHomeSceneAtmosphere(utc)).toEqual(resolveHomeSceneAtmosphere(losAngeles));
    expect(utc.getTime()).toBe(before);
  });

  it('uses the supplied time within a day instead of replacing it with calendar midnight', () => {
    const early = resolveHomeSceneAtmosphere(new Date('2026-08-20T00:00:00Z'));
    const late = resolveHomeSceneAtmosphere(new Date('2026-08-20T23:59:59Z'));
    expect(late.moonPhase - early.moonPhase).toBeGreaterThan(.02);
    expect(late.illuminatedFraction - early.illuminatedFraction).toBeGreaterThan(.05);
  });

  it('rejects invalid instants instead of showing a plausible stale sky', () => {
    expect(() => resolveHomeSceneAtmosphere(new Date(NaN))).toThrow(RangeError);
  });
});

const ZONES: { timezone: string; offset: number; hour: number; period: HomeSkyPeriod }[] = [
  { timezone: 'UTC', offset: 0, hour: 17, period: 'sunset' },
  { timezone: 'Asia/Tokyo', offset: -540, hour: 2, period: 'night' },
  { timezone: 'America/Los_Angeles', offset: 420, hour: 10, period: 'day' },
  { timezone: 'Asia/Kolkata', offset: -330, hour: 23, period: 'night' },
];

describe.each(ZONES)('local sky and absolute moon in $timezone', ({ timezone, offset, hour, period }) => {
  let originalTimezone: string | undefined;
  beforeEach(() => {
    originalTimezone = process.env.TZ;
    process.env.TZ = timezone;
  });
  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it('changes only the local sky for the same new-moon instant', () => {
    const instant = new Date(PRIMARY_PHASES[0].instant);
    expect(instant.getTimezoneOffset()).toBe(offset);
    expect(instant.getHours()).toBe(hour);
    const result = resolveHomeSceneAtmosphere(instant);
    expect(result.period).toBe(period);
    expect(result.moonStage).toBe(0);
    expect(Math.min(result.moonPhase, 1 - result.moonPhase)).toBeLessThan(.002);
    expect(result.illuminatedFraction).toBeLessThan(.005);
  });

  it('switches exactly at every local boundary and crosses midnight without losing the moon instant', () => {
    for (const [boundary, before, after] of [
      [5, 'night', 'dawn'], [8, 'dawn', 'day'],
      [17, 'day', 'sunset'], [19, 'sunset', 'night'],
    ] as const) {
      const instant = new Date(2026, 7, 20, boundary);
      expect(resolveHomeSceneAtmosphere(new Date(instant.getTime() - 1)).period).toBe(before);
      expect(resolveHomeSceneAtmosphere(instant).period).toBe(after);
    }
    const midnight = new Date(2026, 7, 21);
    const before = resolveHomeSceneAtmosphere(new Date(midnight.getTime() - 1));
    const after = resolveHomeSceneAtmosphere(midnight);
    expect([before.period, after.period]).toEqual(['night', 'night']);
    expect(after.moonPhase).toBeGreaterThan(before.moonPhase);
    expect(after.moonPhase - before.moonPhase).toBeLessThan(1e-7);
  });
});

function pixels(path: string): Set<string> {
  return new Set([...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(([, x, y]) => `${x},${y}`));
}

function mirror(points: Set<string>): Set<string> {
  return new Set([...points].map(point => {
    const [x, y] = point.split(',').map(Number);
    return `${11 - x},${y}`;
  }));
}

describe('pixel lunar icon geometry', () => {
  it('draws a stable circular disc, a dark new moon, and a fully lit full moon', () => {
    const disc = pixels(pixelMoonPaths(0).disc);
    expect(disc.size).toBeGreaterThan(80);
    expect(disc).toEqual(mirror(disc));
    expect(pixels(pixelMoonPaths(0).light).size).toBe(0);
    expect(pixels(pixelMoonPaths(4).light)).toEqual(disc);
    for (let stage = 0; stage < 8; stage += 1) {
      const shape = pixelMoonPaths(stage);
      expect(pixels(shape.disc)).toEqual(disc);
      for (const point of pixels(shape.light)) expect(disc.has(point)).toBe(true);
    }
  });

  it.each([1, 2, 3])('mirrors waxing stage %s to its waning counterpart', stage => {
    expect(mirror(pixels(pixelMoonPaths(stage).light))).toEqual(pixels(pixelMoonPaths(8 - stage).light));
  });

  it('lights the right half at first quarter and the left half at last quarter', () => {
    const first = pixels(pixelMoonPaths(2).light);
    const last = pixels(pixelMoonPaths(6).light);
    expect(first.size).toBe(pixels(pixelMoonPaths(2).disc).size / 2);
    expect(last.size).toBe(first.size);
    for (const point of first) expect(Number(point.split(',')[0])).toBeGreaterThanOrEqual(6);
    for (const point of last) expect(Number(point.split(',')[0])).toBeLessThan(6);
    expect(new Set([...first, ...last])).toEqual(pixels(pixelMoonPaths(2).disc));
  });

  it('adds illuminated pixels through waxing and removes them through waning', () => {
    const sizes = Array.from({ length: 9 }, (_, stage) => pixels(pixelMoonPaths(stage).light).size);
    for (let stage = 1; stage <= 4; stage += 1) expect(sizes[stage]).toBeGreaterThan(sizes[stage - 1]);
    for (let stage = 5; stage <= 8; stage += 1) expect(sizes[stage]).toBeLessThan(sizes[stage - 1]);
    expect(pixelMoonPaths(8)).toEqual(pixelMoonPaths(0));
    expect(pixelMoonPaths(-1)).toEqual(pixelMoonPaths(7));
  });
});
