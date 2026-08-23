import { expect, test } from '@playwright/test';
import {
  clickPrimaryNav,
  installVisualGuards,
  seedRegressionUser,
  waitForVisualReady,
} from './support/ui-regression.mjs';

async function captureSurface(page, name, selector) {
  await waitForVisualReady(page, selector);
  await expect(page).toHaveScreenshot(`${name}.png`);
}

test('primary application surfaces match the approved visual baseline', async ({ page }, testInfo) => {
  const theme = testInfo.project.metadata.theme ?? 'light';
  await seedRegressionUser(page, { theme });
  await page.goto('/');
  await installVisualGuards(page);

  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await captureSurface(page, 'home', '.home-main > .home-dashboard');

  await clickPrimaryNav(page, '教材');
  await captureSurface(page, 'bookshelf', '.bookshelf-view');

  await clickPrimaryNav(page, '予定');
  await captureSurface(page, 'schedule', '.schedule-workspace-shell');

  await clickPrimaryNav(page, 'AI計画');
  await captureSurface(page, 'ai-planning', '.ai-planning-card');
});
