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

async function assertAndNormalizeScheduleOccurrenceLabels(page) {
  const selectedCell = page.locator('[role="gridcell"][aria-selected="true"]');
  await expect(selectedCell).toContainText('情報資源総論');
  await expect(selectedCell).toContainText('買い物');

  // These labels are the intentional schedule-authority behavior added by #278.
  // Verify their semantic visibility above, then remove only the event-pill nodes
  // before the broad page screenshot so the existing layout baseline keeps
  // detecting unrelated regressions (for example header/date rendering changes).
  await selectedCell.locator('.month-major-event-pill').evaluateAll((elements) => {
    elements.forEach((element) => element.remove());
  });
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
  await assertAndNormalizeScheduleOccurrenceLabels(page);
  await captureSurface(page, 'schedule', '.schedule-workspace-shell');

  await clickPrimaryNav(page, 'AI計画');
  await captureSurface(page, 'ai-planning', '.ai-planning-card');
});
