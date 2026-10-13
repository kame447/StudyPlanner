import { expect, test } from './support/fixed-clock.mjs';

async function seed(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('public-navigation-loads', String(Number(sessionStorage.getItem('public-navigation-loads') || 0) + 1));
    if (localStorage.getItem('public-navigation-seeded')) return;
    const user = { id: 'public-navigation-user', email: 'navigation@example.test', username: 'Navigation', avatar: '', createdAt: new Date().toISOString() };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('public-navigation-seeded', 'true');
  });
}
async function openContact(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const settings = page.getByRole('main', { name: 'アプリ設定' });
  await settings.getByRole('tab', { name: 'サポート', exact: true }).click();
  await settings.getByRole('link', { name: 'お問い合わせ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/contact$/);
}

for (const width of [1280, 390]) {
  test(`contact round-trip keeps the document, Home and retained portal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await seed(page); await page.goto('/');
    const home = page.locator('.home-today-panel'); await expect(home).toBeVisible();
    const homeNode = await home.elementHandle();
    const documentLoads = await page.evaluate(() => sessionStorage.getItem('public-navigation-loads'));
    await page.evaluate(() => {
      const notice = document.createElement('div');
      notice.id = 'public-navigation-independent-notice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2000';
      notice.textContent = '独立した通知';
      document.body.append(notice);
    });
    await openContact(page);
    await expect(page.locator('#public-navigation-independent-notice')).toBeVisible();
    await page.locator('#public-navigation-independent-notice').evaluate(element => element.remove());
    await expect(home).toBeHidden();
    await expect(page.getByRole('link', { name: 'Laplanceへ戻る', exact: true })).toBeFocused();
    await page.goBack();
    const settings = page.getByRole('main', { name: 'アプリ設定' });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('tab', { name: 'サポート', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(settings.getByRole('link', { name: 'お問い合わせ', exact: true })).toBeFocused();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
    await expect(page).toHaveURL(/\/$/); await expect(home).toBeVisible();
    await expect(settings).toHaveCount(0);
    expect(await homeNode.evaluate(node => node.isConnected && node === document.querySelector('.home-today-panel'))).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('public-navigation-loads'))).toBe(documentLoads);

    // Return through the original history, open an unsaved body-portal form,
    // then use native Forward to revisit settings and contact above that form.
    await page.goBack(); await page.goBack(); await page.goBack(); await expect(home).toBeVisible();
    await page.getByRole('button', { name: '今日の予定に追加', exact: true }).click();
    await page.getByRole('button', { name: '学習予定を追加', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '予定・記録の追加', exact: true });
    await expect(editor).toBeVisible();
    const editorNode = await editor.elementHandle();
    await page.goForward(); await expect(settings).toBeVisible();
    await page.goForward(); await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    await expect(editor).toBeHidden();
    await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
    await expect(editor).toBeVisible();
    expect(await editorNode.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('public-navigation-loads'))).toBe(documentLoads);
  });

  test(`public pages keep a running study session and scroll under its body lock at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await seed(page); await page.goto('/');
    await openContact(page); await page.goBack(); await page.goBack();
    await page.getByRole('button', { name: /勉強を開始/ }).click();
    await page.getByRole('dialog', { name: '学習を開始', exact: true }).getByRole('button', { name: 'スタート', exact: true }).click();
    const running = page.getByRole('dialog', { name: '学習中', exact: true });
    await expect(running).toBeVisible();
    const pane = await running.locator('.study-session-page').elementHandle();
    const elapsedSeconds = async () => (await running.locator('[data-study-session-elapsed]').textContent()).trim().split(':').reduce((total, value) => total * 60 + Number(value), 0);
    const elapsedBefore = await elapsedSeconds();
    await page.goForward();
    const settings = page.getByRole('main', { name: 'アプリ設定' }); await expect(settings).toBeVisible();
    await page.goForward(); await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    await expect(running).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.goBack();
    await settings.getByRole('tab', { name: 'サポート', exact: true }).click();
    await settings.getByRole('link', { name: '利用規約', exact: true }).click();
    const surface = page.locator('.public-page-surface');
    await expect(page.getByRole('heading', { name: '利用規約', exact: true })).toBeVisible();
    await page.keyboard.press('PageDown');
    await expect.poll(() => surface.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.clock.fastForward(60_000);
    await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
    await expect(running).toBeVisible();
    expect(await pane.evaluate(node => node.isConnected && node === document.querySelector('.study-session-page'))).toBe(true);
    await expect.poll(elapsedSeconds).toBeGreaterThanOrEqual(elapsedBefore + 60);
    expect(await page.evaluate(() => sessionStorage.getItem('public-navigation-loads'))).toBe('1');
  });
}

test('direct contact URL survives reload and returns through normal startup in the same document', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    localStorage.setItem('study-planner-theme-mode', 'dark');
    localStorage.setItem('study-planner-theme-palette', 'ocean');
  });
  await page.goto('/contact');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--accent').trim())).toBe('#6fb2ff');
  await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
  await expect(page.locator('.home-today-panel')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const loads = await page.evaluate(() => sessionStorage.getItem('public-navigation-loads'));
  await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
  await expect(page.locator('.home-today-panel')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('public-navigation-loads'))).toBe(loads);
});

for (const width of [1280, 390]) {
  test(`startup finishing behind contact waits for visible Home geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new globalThis.URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
    await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export function useWeeklyPlanningTracePolicy() {
        const control = window.__startupGateHarness;
        const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
        return { status, error: '', accept: async () => false, refresh: async () => {} };
      }
    ` }));
    // Load the existing controlled-startup harness at a public initial URL.
    // Subsequent Back/Forward and return-link clicks use real browser history.
    await page.addInitScript(() => {
      if (location.pathname === '/startup-gates.html') history.replaceState(null, '', '/contact');
    });
    await page.goto('http://127.0.0.1:4174/startup-gates.html');
    await page.waitForFunction(() => Boolean(window.__startupGateHarness));
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
    await expect(page.locator('.splash-screen')).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('accepted'); });
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryRepository.snapshot().pendingReads)).toContain('getScheduleSnapshot');
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.splash-screen')).toHaveCount(0);
    await expect(page.locator('.home-core-sections')).toHaveCount(0);
    await page.goForward();
    const home = page.locator('.home-core-sections');
    await expect(home).toBeVisible();
    const homeNode = await home.elementHandle();
    const header = page.locator('.home-primary-header');
    await expect.poll(() => header.getAttribute('data-home-chrome-viewport')).toBe(`${width}x844`);
    expect((await home.boundingBox()).height).toBeGreaterThan(0);
    expect((await page.locator('.home-schedule-list').boundingBox()).height).toBeGreaterThan(0);
    await page.goBack(); await expect(home).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.goForward(); await expect(home).toBeVisible();
    expect(await homeNode.evaluate(node => node.isConnected && node === document.querySelector('.home-core-sections'))).toBe(true);
    expect((await page.locator('.home-schedule-list').boundingBox()).height).toBeGreaterThan(0);
  });
}
