import { expect, test } from '@playwright/test';

async function seedSchedule(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'schedule-sheet-e2e-user',
      email: 'schedule-sheet-e2e@example.com',
      username: 'schedule-sheet-e2e',
      avatar: '',
      createdAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '予定' })
    .click();
  await expect(page.locator('.schedule-month-view')).toBeVisible();
}

test('quick add grows from the FAB with ordered actions and hands off to the schedule editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSchedule(page);
  await openSchedule(page);

  const trigger = page.getByRole('button', { name: 'クイック追加メニューを開く' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const actions = page.locator('.quick-add-option');
  await expect(actions).toHaveCount(3);
  await expect(actions).toHaveText(['AI計画', '学習を追加', '予定を追加']);

  const triggerTransform = await page
    .locator('.quick-add-trigger-icon')
    .evaluate((element) => getComputedStyle(element).transform);
  expect(triggerTransform).not.toBe('none');

  await expect
    .poll(() => actions.last().evaluate((element) => getComputedStyle(element).animationName))
    .toContain('quick-add-option-in');

  await page.screenshot({
    path: 'artifacts/quick-add-menu-mobile.png',
    fullPage: true,
  });

  await page.getByRole('menuitem', { name: '予定を追加' }).click();
  await expect(page.locator('.month-event-modal-overlay')).toBeVisible();

  await expect
    .poll(() => trigger.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('0');
});

test('day detail rises as a bottom sheet and transfers the add action without a duplicate visible FAB', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSchedule(page);
  await openSchedule(page);

  const globalFab = page.getByRole('button', { name: 'クイック追加メニューを開く' });
  await expect(globalFab).toBeVisible();

  const dayCell = page.locator('.schedule-month-view .month-cell:not(.is-muted)').first();
  await dayCell.click();

  const overlay = page.locator('.month-day-sheet-overlay');
  const sheet = page.locator('.month-day-sheet');
  const sheetAdd = page.getByRole('button', { name: '予定を追加' });

  await expect(overlay).toHaveAttribute('data-state', 'open');
  await expect(sheet).toBeVisible();
  await expect(sheetAdd).toHaveCount(1);

  await expect
    .poll(() => globalFab.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('0');

  await expect
    .poll(() => sheet.evaluate((element) => getComputedStyle(element).animationName))
    .toContain('month-day-sheet-panel-in');

  await page.screenshot({
    path: 'artifacts/schedule-day-sheet-mobile.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(overlay).toHaveAttribute('data-state', 'closing');
  await expect(overlay).toHaveCount(0, { timeout: 1000 });

  await expect
    .poll(() => globalFab.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('1');
});
