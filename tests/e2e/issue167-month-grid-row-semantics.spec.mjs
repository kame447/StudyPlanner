import { expect, test } from '@playwright/test';

async function seedSchedule(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'issue167-grid-user',
      email: 'issue167-grid@example.com',
      username: 'issue167-grid',
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

test('month ARIA grid exposes seven semantic rows without changing keyboard flow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSchedule(page);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();

  const grid = page.getByRole('grid', { name: '月間カレンダー' });
  await expect(grid).toBeVisible();

  const rows = grid.locator(':scope > [role="row"]');
  await expect(rows).toHaveCount(7);
  await expect(rows.first().locator(':scope > [role="columnheader"]')).toHaveCount(7);

  for (let rowIndex = 1; rowIndex < 7; rowIndex += 1) {
    await expect(rows.nth(rowIndex).locator(':scope > [role="gridcell"]')).toHaveCount(7);
  }

  const selectedCell = grid.locator('[role="gridcell"][aria-selected="true"]');
  await expect(selectedCell).toHaveCount(1);
  await selectedCell.focus();
  await page.keyboard.press('ArrowRight');

  const movedCell = grid.locator('[role="gridcell"][aria-selected="true"]');
  await expect(movedCell).toHaveCount(1);
  await expect(movedCell).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('.month-event-modal-overlay')).toBeVisible();
});
