import { expect, test } from '@playwright/test';

const HARNESS_URL = 'http://127.0.0.1:4174/week-layout-readability.html';

async function elementWidth(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element is not measurable');
  return box.width;
}

test('week width splitting is local to real overlap clusters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HARNESS_URL);

  const dayColumn = page.locator('.schedule-week-day-column').first();
  const dayWidth = await elementWidth(dayColumn);
  const overlapA = page.locator('[title^="重複A / "]');
  const overlapB = page.locator('[title^="重複B / "]');
  const independent = page.locator('[title^="独立予定 / "]');
  const touching = page.locator('[title^="境界予定 / "]');

  await expect(overlapA).toBeVisible();
  await expect(overlapB).toBeVisible();
  await expect(independent).toBeVisible();
  await expect(touching).toBeVisible();

  expect(await elementWidth(overlapA)).toBeLessThan(dayWidth * 0.6);
  expect(await elementWidth(overlapB)).toBeLessThan(dayWidth * 0.6);
  expect(await elementWidth(independent)).toBeGreaterThan(dayWidth * 0.85);
  expect(await elementWidth(touching)).toBeGreaterThan(dayWidth * 0.85);
});

test('week spanning cards use normal title typography and available width before ellipsis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HARNESS_URL);

  const spanning = page.locator('[data-week-spanning-event="true"]').filter({ hasText: 'オープン' });
  const normalTitle = page.locator('[title^="独立予定 / "] strong');

  await expect(spanning).toBeVisible();
  await expect(normalTitle).toBeVisible();
  await expect(spanning).toHaveText('オープン');

  const metrics = await spanning.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      marginLeft: Number.parseFloat(style.marginLeft),
      marginRight: Number.parseFloat(style.marginRight),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  const normalFontSize = await normalTitle.evaluate((element) => getComputedStyle(element).fontSize);

  expect(metrics.fontSize).toBe(normalFontSize);
  expect(metrics.paddingLeft).toBeLessThanOrEqual(2);
  expect(metrics.paddingRight).toBeLessThanOrEqual(2);
  expect(metrics.marginLeft).toBeLessThanOrEqual(1);
  expect(metrics.marginRight).toBeLessThanOrEqual(1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});
