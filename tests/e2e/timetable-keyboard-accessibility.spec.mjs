import { expect, test } from '@playwright/test';

async function seedUser(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'timetable-keyboard-user',
      email: 'timetable-keyboard@example.com',
      username: 'timetable-keyboard',
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
    localStorage.setItem('studyplanner.scheduleTemplates.v1', '[]');
    localStorage.setItem('studyplanner.timetableTerms.v1', '[]');
    localStorage.setItem('studyplanner.timetablePeriods.v1', '[]');
  });
}

async function openTimetable(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedUser(page);
  await page.goto('/');

  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '時間割' })
    .click();
  await expect(page.locator('.timetable-view')).toBeVisible();
}

test('empty timetable cells remain operable with the keyboard', async ({ page }) => {
  await openTimetable(page);

  const emptyCell = page.getByRole('button', { name: '月曜 1限 授業を追加' });
  await emptyCell.focus();
  await expect(emptyCell).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('.timetable-editor-modal')).toBeVisible();
  await expect(page.getByLabel('授業名')).toBeVisible();
});

test('pointer users still need a deliberate double tap to create an empty timetable cell', async ({
  page,
}) => {
  await openTimetable(page);

  const emptyCell = page.getByRole('button', { name: '月曜 1限 授業を追加' });
  const pointerEvent = {
    pointerId: 1,
    clientX: 120,
    clientY: 220,
  };

  await emptyCell.dispatchEvent('pointerdown', pointerEvent);
  await emptyCell.dispatchEvent('pointerup', pointerEvent);
  await expect(page.locator('.timetable-editor-modal')).toBeHidden();

  await page.waitForTimeout(50);
  await emptyCell.dispatchEvent('pointerdown', pointerEvent);
  await emptyCell.dispatchEvent('pointerup', pointerEvent);

  await expect(page.locator('.timetable-editor-modal')).toBeVisible();
  await expect(page.getByLabel('授業名')).toBeVisible();
});
