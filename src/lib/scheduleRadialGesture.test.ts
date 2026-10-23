import { describe, expect, it } from 'vitest';
import { selectScheduleRadialGesture } from './scheduleRadialGesture';
import { computeScheduleRadialMenuLayout, type RadialPoint } from './scheduleRadialMenuLayout';

const centred = computeScheduleRadialMenuLayout({
  anchorRect: { left: 180, top: 180, width: 40, height: 40 },
  viewport: { width: 400, height: 400 },
});
const pointAt = (degrees: number, radius = 80, anchor = centred.anchor): RadialPoint => ({
  x: anchor.x + Math.cos(degrees * Math.PI / 180) * radius,
  y: anchor.y + Math.sin(degrees * Math.PI / 180) * radius,
});

describe('continuous radial gesture geometry', () => {
  it.each([
    ['up', 0, { x: 200, y: 120 }],
    ['upper right', 1, { x: 269.2820323027551, y: 160 }],
    ['lower right', 2, { x: 269.2820323027551, y: 240 }],
    ['down', 3, { x: 200, y: 280 }],
    ['lower left', 4, { x: 130.71796769724492, y: 240 }],
    ['upper left', 5, { x: 130.71796769724492, y: 160 }],
  ] as const)('selects the drawn %s action', (_direction, index, point) => {
    expect(selectScheduleRadialGesture(centred, point, centred.anchor)).toBe(index);
  });

  it.each([
    [-60, 0, 1], [0, 1, 2], [60, 2, 3],
    [120, 3, 4], [180, 4, 5], [240, 5, 0],
  ])('changes sector across the %s degree bisector, including the wrap', (boundary, before, after) => {
    // Do not mandate an arbitrary tie-breaking policy exactly on a bisector.
    expect(selectScheduleRadialGesture(centred, pointAt(boundary - 0.01), centred.anchor)).toBe(before);
    expect(selectScheduleRadialGesture(centred, pointAt(boundary + 0.01), centred.anchor)).toBe(after);
  });

  it('does not select within the 24px hold dead zone and resumes just beyond it', () => {
    for (const distance of [0, 12, 24]) {
      expect(selectScheduleRadialGesture(centred, { x: 200, y: 200 - distance }, centred.anchor)).toBeNull();
    }
    expect(selectScheduleRadialGesture(centred, { x: 200, y: 175.99 }, centred.anchor)).toBe(0);
  });

  it('cancels past the outer envelope instead of selecting an indefinitely distant direction', () => {
    // Radius 80 + diameter 56 + outer allowance 40 = 176 CSS px.
    expect(selectScheduleRadialGesture(centred, { x: 200, y: 24 }, centred.anchor)).toBe(0);
    expect(selectScheduleRadialGesture(centred, { x: 200, y: 23.99 }, centred.anchor)).toBeNull();
    expect(selectScheduleRadialGesture(centred, { x: 200, y: -1000 }, centred.anchor)).toBeNull();
    expect(selectScheduleRadialGesture(centred, { x: 200, y: 120 }, centred.anchor)).toBe(0);
  });

  it.each([
    ['top left', { x: 5, y: 5 }],
    ['bottom right', { x: 315, y: 563 }],
  ] as const)('uses the rendered ring at the %s edge while preserving both cancel centres', (_edge, origin) => {
    const layout = computeScheduleRadialMenuLayout({
      anchorRect: { left: origin.x - 5, top: origin.y - 5, width: 10, height: 10 },
      viewport: { width: 320, height: 568 },
      safeInsets: { top: 24, right: 5, bottom: 34, left: 5 },
    });
    expect(layout.anchor).not.toEqual(origin);
    // No movement may trigger an action merely because the ring was shifted.
    expect(selectScheduleRadialGesture(layout, origin, origin)).toBeNull();
    expect(selectScheduleRadialGesture(layout, { x: origin.x + 24, y: origin.y }, origin)).toBeNull();
    // Returning to the visible empty centre must cancel too.
    expect(selectScheduleRadialGesture(layout, layout.anchor, origin)).toBeNull();
    expect(selectScheduleRadialGesture(layout, { x: layout.anchor.x, y: layout.anchor.y + 24 }, origin)).toBeNull();
    for (const [degrees, index] of [[-90, 0], [-30, 1], [30, 2], [90, 3], [150, 4], [210, 5]]) {
      const point = pointAt(degrees, layout.radius, layout.anchor);
      expect(selectScheduleRadialGesture(layout, point, origin)).toBe(index);
    }
  });

  it('uses the actual smaller ring envelope on a constrained viewport', () => {
    const layout = computeScheduleRadialMenuLayout({
      anchorRect: { left: 90, top: 95, width: 20, height: 20 },
      viewport: { width: 200, height: 210 },
    });
    expect(layout.radius).toBeLessThan(80);
    expect(selectScheduleRadialGesture(layout, pointAt(-90, layout.radius, layout.anchor), layout.anchor)).toBe(0);
    expect(selectScheduleRadialGesture(layout, pointAt(-90, layout.radius + layout.buttonDiameter + 40.01, layout.anchor), layout.anchor)).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])('rejects invalid pointer, origin and centre coordinates (%s)', invalid => {
    const valid = { x: 200, y: 120 };
    for (const key of ['x', 'y'] as const) {
      expect(selectScheduleRadialGesture(centred, { ...valid, [key]: invalid }, centred.anchor)).toBeNull();
      expect(selectScheduleRadialGesture(centred, valid, { ...centred.anchor, [key]: invalid })).toBeNull();
      expect(selectScheduleRadialGesture({ ...centred, anchor: { ...centred.anchor, [key]: invalid } }, valid, centred.anchor)).toBeNull();
    }
  });
});
