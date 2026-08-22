import { expect, test } from '@playwright/test';
import {
  clickPrimaryNav,
  readDocumentBounds,
  seedRegressionUser,
} from './support/ui-regression.mjs';

async function expectNoHorizontalOverflow(page) {
  const bounds = await readDocumentBounds(page);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth + 1);
}

async function expectSurface(page, selector) {
  await expect(page.locator(selector).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
}

for (const theme of ['light', 'dark']) {
  test(`${theme} primary navigation remains operable across the browser engine`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await seedRegressionUser(page, { theme });
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectSurface(page, '.home-main > .home-dashboard');

    await clickPrimaryNav(page, '教材');
    await expectSurface(page, '.bookshelf-view');

    await clickPrimaryNav(page, '予定');
    await expectSurface(page, '.schedule-workspace-shell');

    await clickPrimaryNav(page, 'AI計画');
    await expectSurface(page, '.ai-planning-card');

    expect(pageErrors).toEqual([]);
  });
}
