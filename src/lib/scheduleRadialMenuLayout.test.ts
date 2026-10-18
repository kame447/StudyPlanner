import { describe, expect, it } from 'vitest';
import { computeScheduleRadialMenuLayout, type ScheduleRadialMenuLayout } from './scheduleRadialMenuLayout';

function expectRegularClockwiseRing(layout: ScheduleRadialMenuLayout) {
  const { anchor, nodes, radius } = layout;
  expect(nodes).toHaveLength(6);
  expect(Math.abs(nodes[0].x - anchor.x)).toBeLessThan(1e-9);
  expect(nodes[0].y).toBeLessThan(anchor.y);
  nodes.forEach((node, index) => {
    const next = nodes[(index + 1) % nodes.length];
    const a = { x: node.x - anchor.x, y: node.y - anchor.y };
    const b = { x: next.x - anchor.x, y: next.y - anchor.y };
    expect(Math.abs(Math.hypot(a.x, a.y) - radius)).toBeLessThan(1e-9);
    // Positive cross product is clockwise in screen coordinates (y down).
    const angle = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
    expect(Math.abs(angle - Math.PI / 3)).toBeLessThan(1e-9);
    expect(Math.hypot(next.x - node.x, next.y - node.y)).toBeGreaterThanOrEqual(layout.buttonDiameter + 6 - 1e-9);
  });
}

describe.each([{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }])('radial layout in $width × $height', viewport => {
  it.each(['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])('fits the whole ring at %s', edge => {
    const anchorRect = {
      left: edge.includes('left') ? 0 : edge.includes('right') ? viewport.width - 30 : viewport.width / 2 - 15,
      top: edge.includes('top') ? 0 : edge.includes('bottom') ? viewport.height - 30 : viewport.height / 2 - 15,
      width: 30, height: 30,
    };
    const safeInsets = { top: 24, right: 5, bottom: 34, left: 5 };
    const layout = computeScheduleRadialMenuLayout({ anchorRect, viewport, safeInsets });
    expectRegularClockwiseRing(layout);
    expect(layout.fallback).toBe(false);
    expect(layout.radius).toBe(80); // Shift before shrinking, even at a corner.
    layout.nodes.forEach(node => {
      expect(node.x - layout.buttonDiameter / 2).toBeGreaterThanOrEqual(safeInsets.left + 10 - 1e-9);
      expect(node.x + layout.buttonDiameter / 2).toBeLessThanOrEqual(viewport.width - safeInsets.right - 10 + 1e-9);
      expect(node.y - layout.buttonDiameter / 2).toBeGreaterThanOrEqual(safeInsets.top + 10 - 1e-9);
      expect(node.y + layout.buttonDiameter / 2).toBeLessThanOrEqual(viewport.height - safeInsets.bottom - 10 + 1e-9);
    });
  });
});

it('keeps the original centre when it fits, and projects to the closest possible centre otherwise', () => {
  const viewport = { width: 500, height: 500 };
  const centred = computeScheduleRadialMenuLayout({ viewport, anchorRect: { left: 230, top: 230, width: 40, height: 40 } });
  expect(centred.anchor).toEqual({ x: 250, y: 250 });
  const shifted = computeScheduleRadialMenuLayout({ viewport, anchorRect: { left: -20, top: 230, width: 40, height: 40 } });
  expect(shifted.anchor.y).toBe(250);
  expect(shifted.anchor.x).toBeCloseTo(10 + 28 + 80 * Math.sin(Math.PI / 3), 12);
});

it('shrinks one shared radius only when shifting alone cannot fit', () => {
  const layout = computeScheduleRadialMenuLayout({ viewport: { width: 200, height: 210 }, anchorRect: { left: 0, top: 0, width: 20, height: 20 } });
  expect(layout.radius).toBeLessThan(80);
  expect(layout.radius).toBeGreaterThanOrEqual(62);
  expect(layout.fallback).toBe(false);
  expectRegularClockwiseRing(layout);
  layout.nodes.forEach(node => {
    expect(node.x - 28).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(node.x + 28).toBeLessThanOrEqual(190 + 1e-9);
    expect(node.y - 28).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(node.y + 28).toBeLessThanOrEqual(200 + 1e-9);
  });
});

it('documents impossible viewports by centring a non-overlapping minimum ring without clamping nodes', () => {
  const layout = computeScheduleRadialMenuLayout({ viewport: { width: 120, height: 100 }, anchorRect: { left: 0, top: 0, width: 20, height: 20 }, buttonDiameter: 20 });
  expect(layout.buttonDiameter).toBe(44);
  expect(layout.radius).toBe(50);
  expect(layout.anchor).toEqual({ x: 60, y: 50 });
  expect(layout.fallback).toBe(true);
  expectRegularClockwiseRing(layout);
});
