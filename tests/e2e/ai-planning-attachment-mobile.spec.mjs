import { expect, test } from '@playwright/test';

async function seedHome(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'ai-planning-attachment-mobile-user',
      email: 'ai-planning-attachment-mobile@example.com',
      username: 'ai-planning-attachment-mobile-user',
      avatar: '',
      createdAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

test('AI planning keeps the photo attachment button visible on a 360px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await seedHome(page);
  await page.goto('/');
  await page.locator('.home-bottom-nav button').first().click();

  const attachmentButton = page.getByRole('button', { name: '写真を追加' });
  await expect(attachmentButton).toBeVisible();
  await expect(page.locator('.ai-planning-attachment-input')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg',
  );

  await expect(page.locator('.ai-planning-mic-button')).toBeHidden();
  await expect(page.locator('.ai-planning-send-button')).toBeVisible();
});
