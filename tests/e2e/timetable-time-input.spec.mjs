import { expect, test } from '@playwright/test';

async function seedAuthenticatedUser(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'timetable-time-input-user',
      email: 'timetable-time-input@example.com',
      username: 'timetable-time-input',
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

test('timetable period time inputs are visible and directly editable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedAuthenticatedUser(page);
  await page.goto('/');

  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '時間割' })
    .click();

  await expect(page.locator('.timetable-view')).toBeVisible();

  const startTimeInput = page.locator('input[aria-label="1限 開始時刻"]');
  await expect(startTimeInput).toBeVisible();

  const interactionStyle = await startTimeInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      position: style.position,
    };
  });

  expect(interactionStyle.opacity).toBe('1');
  expect(interactionStyle.pointerEvents).not.toBe('none');
  expect(interactionStyle.position).not.toBe('absolute');

  await startTimeInput.click();
  await startTimeInput.fill('09:15');
  await expect(startTimeInput).toHaveValue('09:15');
});
