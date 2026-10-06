import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

async function browseAnotherDateThenHome(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'ホーム' }).click();
}

for (const width of [390, 1280]) {
  test(`Home adds an event or study without Calendar navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      if (localStorage.getItem('home-create-seeded')) return;
      const now = new Date().toISOString();
      const user = { id: 'home-create-user', email: 'home-create@example.com', username: 'Home検証', avatar: '', createdAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
      localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{ id: 'home-todo', userId: user.id, title: '検証課題', subject: '', type: 'study', estimatedMinutes: 30, dueDate: '2026-08-20', memo: '', status: 'open', scheduledPlanId: null, createdAt: now, updatedAt: now }]));
      localStorage.setItem('home-create-seeded', '1');
    });
    await page.goto('/');
    const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
    const home = page.locator('.home-main');
    await expect(home).toBeVisible();
    await expect(home).not.toContainText('今日の予定はまだありません');
    await browseAnotherDateThenHome(page);
    await add.click();
    const chooser = page.getByRole('dialog', { name: '今日の予定に追加', exact: true });
    await expect(chooser.getByRole('button')).toHaveCount(3);
    await expect(chooser.locator('.lucide-calendar-plus')).toHaveCount(1);
    await expect(chooser.locator('.lucide-book-open-check')).toHaveCount(1);
    await expect(chooser.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    if (width === 390) expect((await chooser.boundingBox()).y).toBeGreaterThan(500);
    await page.screenshot({ path: testInfo.outputPath('home-add-chooser.png'), fullPage: true });
    await testInfo.attach('Home two-choice sheet', { path: testInfo.outputPath('home-add-chooser.png'), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0); await expect(add).toBeFocused();
    await add.click();
    await chooser.getByRole('button', { name: '予定を追加', exact: true }).click();
    const event = page.locator('.month-event-modal');
    await expect(event.getByRole('button', { name: '開始日', exact: true })).toContainText('2026年8月19日');
    await event.getByLabel('タイトル', { exact: true }).fill('ホームから予定');
    await event.getByRole('button', { name: '保存', exact: true }).click();
    await expect(event).toHaveCount(0); await expect(home).toBeVisible();
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから予定');
    await browseAnotherDateThenHome(page);
    await add.click(); await chooser.getByRole('button', { name: '学習を追加', exact: true }).click();
    const study = page.getByRole('dialog', { name: '予定・記録の追加' });
    await expect(study.getByLabel('日付', { exact: true })).toHaveValue(E2E_TODAY);
    await study.getByPlaceholder('例: 英語課題 / 面接準備').fill('ホームから学習');
    await study.getByRole('button', { name: '30分', exact: true }).click();
    await study.getByRole('button', { name: '保存', exact: true }).click();
    await expect(study).toHaveCount(0); await expect(home).toBeVisible();
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから学習');
    await expect(page.locator('.schedule-month-view')).toHaveCount(0);
    await page.reload();
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから予定');
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから学習');
  });
}
