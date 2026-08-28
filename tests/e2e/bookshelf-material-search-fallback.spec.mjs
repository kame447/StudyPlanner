import { expect, test } from '@playwright/test';

function seedBookshelfState(page) {
  return page.addInitScript(() => {
    const createdAt = new Date().toISOString();
    const user = {
      id: 'material-search-user',
      email: 'material-search@example.com',
      username: 'material-search',
      avatar: '',
      createdAt,
    };
    const subject = {
      id: 'material-search-subject',
      userId: user.id,
      name: '英語',
      color: '#2f6fc2',
      createdAt,
      updatedAt: createdAt,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function openAddMaterialSheet(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBookshelfState(page);
  await page.goto('/');

  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '教材' })
    .click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
  await page.locator('.bookshelf-add-material-fab').click();

  const sheet = page.locator(
    '.bookshelf-view > .modal-overlay:has(> .bookshelf-modal .bookshelf-material-edit-grid)',
  );
  await expect(sheet).toBeVisible();
  return sheet;
}

test('known material names are searchable from the built-in catalog without the provider', async ({ page }) => {
  const sheet = await openAddMaterialSheet(page);

  await sheet.getByLabel('ISBN / 教材名').fill('青チャート');
  await sheet.getByRole('button', { name: '検索', exact: true }).click();

  const candidate = sheet.getByRole('button', { name: '青チャート', exact: true });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(sheet.getByLabel('教材名', { exact: true })).toHaveValue('青チャート');
  await expect(sheet.getByLabel('教科')).toHaveValue('material-search-subject');
});

test('material search failure never blocks manual material registration', async ({ page }) => {
  const sheet = await openAddMaterialSheet(page);

  await sheet.getByLabel('ISBN / 教材名').fill('9784023315686');
  await sheet.getByRole('button', { name: '検索', exact: true }).click();
  await expect(sheet).toContainText('手入力で登録できます。');

  await sheet.getByLabel('教材名', { exact: true }).fill('手入力教材');
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.bookshelf-view')).toContainText('手入力教材');
});
