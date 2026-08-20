import { expect } from '@playwright/test';

export function expectRectContained(parent, child, tolerance = 1) {
  expect(parent).not.toBeNull();
  expect(child).not.toBeNull();
  if (!parent || !child) return;

  expect(child.left).toBeGreaterThanOrEqual(parent.left - tolerance);
  expect(child.top).toBeGreaterThanOrEqual(parent.top - tolerance);
  expect(child.right).toBeLessThanOrEqual(parent.right + tolerance);
  expect(child.bottom).toBeLessThanOrEqual(parent.bottom + tolerance);
}

export function expectOrderedWithoutOverlap(first, second, tolerance = 1) {
  if (!first || !second) return;
  expect(first.bottom).toBeLessThanOrEqual(second.top + tolerance);
}
