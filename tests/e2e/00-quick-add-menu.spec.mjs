import { expect, test } from '@playwright/test';

async function seedSchedule(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'quick-add-e2e-user',
      email: 'quick-add-e2e@example.com',
      username: 'quick-add-e2e',
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

test('quick add grows from the FAB, supports keyboard navigation, and hands off to the schedule editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSchedule(page);
  await openSchedule(page);

  const trigger = page.locator('.quick-add-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAccessibleName('クイック追加メニューを開く');
  await trigger.click();

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAccessibleName('クイック追加メニューを閉じる');

  const actions = page.locator('.quick-add-option');
  await expect(actions).toHaveCount(3);
  await expect(actions).toHaveText(['AI計画', '学習を追加', '予定を追加']);

  const aiAction = page.getByRole('menuitem', { name: 'AI計画' });
  const studyAction = page.getByRole('menuitem', { name: '学習を追加' });
  const scheduleAction = page.getByRole('menuitem', { name: '予定を追加' });
  await expect(aiAction).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(studyAction).toBeFocused();
  await page.keyboard.press('End');
  await expect(scheduleAction).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(aiAction).toBeFocused();

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

  await scheduleAction.click();
  await expect(page.locator('.month-event-modal-overlay')).toBeVisible();
  await expect
    .poll(() => trigger.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('0');
});
