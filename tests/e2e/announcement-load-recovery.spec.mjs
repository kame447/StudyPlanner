import { expect, test } from './support/fixed-clock.mjs';

async function start(page, theme = 'light') {
  const documents = [];
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.addInitScript(theme => {
    const user = { id: 'announcement-load-owner', username: 'Announcement fixture', email: 'announcement@example.test', avatar: '', createdAt: new Date().toISOString() };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('study-planner-theme-mode', theme);
    for (const key of ['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos.v1', 'studyMaterials.v1', 'studySubjects.v1',
      'scheduleTemplates.v1', 'timetableTerms.v1', 'timetablePeriods.v1']) localStorage.setItem(`studyplanner.${key}`, '[]');
  }, theme);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'お知らせを開く', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const persisted = await page.evaluate(() => {
    window.__announcementDocument = 'retained';
    return Object.fromEntries(['studyplanner.session', 'studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1']
      .map(key => [key, localStorage.getItem(key)]));
  });
  return async () => {
    expect(documents).toHaveLength(1);
    expect(await page.evaluate(() => window.__announcementDocument)).toBe('retained');
    expect(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(persisted))).toEqual(persisted);
  };
}

for (const resource of ['js', 'css']) for (const theme of ['light', 'dark']) {
  test(`failed production announcement ${resource} keeps Home, history and focus at ${theme}`, async ({ page }, info) => {
    const sameDocument = await start(page, theme);
    const asset = new RegExp(`/assets/AnnouncementsPage-[^/]+\\.${resource}(?:\\?.*)?$`);
    let attempts = 0;
    await page.route(asset, route => { attempts += 1; return route.abort('failed'); });
    const bell = page.getByRole('button', { name: 'お知らせを開く', exact: true });
    await bell.click();
    const dialog = page.getByRole('dialog', { name: 'お知らせ', exact: true });
    const back = dialog.getByRole('button', { name: 'ホームへ戻る', exact: true });
    await expect(dialog.getByRole('alert')).toHaveText('お知らせを読み込めませんでした。');
    await expect(back).toBeFocused();
    expect(attempts).toBe(1);
    await sameDocument();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    await info.attach(`announcement-${resource}-${theme}-failure`, { body: await page.screenshot(), contentType: 'image/png' });
    await back.click();
    await expect(dialog).toHaveCount(0); await expect(bell).toBeFocused();
    await page.goForward();
    await expect(dialog).toBeVisible();
    await expect(back).toBeFocused();
    expect(attempts).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(bell).toBeFocused();
    await bell.click(); await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0); await expect(bell).toBeFocused();
    await page.getByRole('button', { name: 'マイページを開く', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'マイページ', exact: true })).toBeVisible();
    await sameDocument();
  });
}

test('Back during announcement delivery keeps silent Home and a late failure stays local on reopen', async ({ page }) => {
  const sameDocument = await start(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requested = false;
  const asset = /\/assets\/AnnouncementsPage-[^/]+\.js(?:\?.*)?$/;
  await page.route(asset, async route => { requested = true; await gate; await route.abort('failed'); });
  const bell = page.getByRole('button', { name: 'お知らせを開く', exact: true });
  try {
    await bell.click(); await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(bell).toBeVisible();
    await page.goBack();
    const failed = page.waitForEvent('requestfailed', request => asset.test(request.url()));
    release(); await failed;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await bell.click();
    await expect(page.getByRole('dialog', { name: 'お知らせ', exact: true }).getByRole('alert')).toContainText('読み込めませんでした');
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(bell).toBeFocused();
    await sameDocument();
  } finally { release(); }
});
