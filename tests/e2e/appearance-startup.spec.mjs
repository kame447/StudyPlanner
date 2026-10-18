import fs from 'node:fs';
import { expect, test } from './support/fixed-clock.mjs';
const font = fs.readFileSync(new URL('../../public/fonts/DotGothic16-Regular.woff2', import.meta.url));

for (const { appearance, stage } of [
  { appearance: 'standard', stage: 'consent' },
  { appearance: 'pixel', stage: 'consent' },
  { appearance: 'pixel', stage: 'week' },
]) {
  test(`cold ${stage} keeps ${appearance} appearance without waiting for App`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fonts = [], styles = [];
    page.on('request', request => {
      if (request.url().includes('DotGothic16')) fonts.push(request.url());
      if (/appearance-pixel[^/]*\.css/.test(request.url())) styles.push(request.url());
    });
    await page.addInitScript(appearance => localStorage.setItem('study-planner-appearance', appearance), appearance);
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    // The harness root differs from public/. Serve only the exact app font,
    // without changing the repository-wide harness or production asset routing.
    await page.route('**/fonts/DotGothic16-Regular.woff2', route => route.fulfill({ contentType: 'font/woff2', body: font }));
    await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
    await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export function useWeeklyPlanningTracePolicy() {
        const control = window.__startupGateHarness;
        const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
        return { status, error: '', accept: async () => false, refresh: async () => {} };
      }
    ` }));
    await page.goto(`http://127.0.0.1:4174/startup-gates.html${stage === 'week' ? '?weekStart=missing' : ''}`);
    await page.waitForFunction(() => Boolean(window.__startupGateHarness));
    await page.evaluate(stage => {
      window.__startupGateHarness.emitAuth();
      window.__startupGateHarness.emitPolicy(stage === 'week' ? 'accepted' : 'required');
    }, stage);
    await expect(page.getByRole('heading', { name: stage === 'week' ? '1週間の始まりを選択' : '初回利用の確認', exact: true })).toBeVisible();
    await expect(page.locator('.home-main')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    if (appearance === 'pixel') {
      await expect.poll(() => page.locator('.auth-main-card').evaluate(e => getComputedStyle(e).fontFamily)).toContain('DotGothic16');
      expect(await page.evaluate(async () => (await document.fonts.load('16px DotGothic16', '初回利用 週の始まり')).map(f => f.status))).toEqual(['loaded']);
      await expect(page.locator('.auth-main-card')).toHaveCSS('border-radius', '0px');
      await expect(page.locator('.auth-stage-card')).toHaveCSS('border-radius', '0px');
      expect(fonts).toHaveLength(1); expect(styles).toHaveLength(1);
    } else {
      expect(fonts).toEqual([]); expect(styles).toEqual([]);
    }
    await expect(page.locator('.auth-main-card')).toBeVisible();
    await info.attach(`cold-${stage}-${appearance}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('initial consent legal links retain the document and explicit confirmation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem('consent-navigation-loads', String(Number(sessionStorage.getItem('consent-navigation-loads') || 0) + 1));
    window.__consentNavigationAcceptCalls = 0;
  });
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  // Only the external policy verdict/write is synthetic; the consent screen,
  // public-page owner, legal pages, history and native clicks are production.
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupGateHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => { window.__consentNavigationAcceptCalls++; return false; }, refresh: async () => {} };
    }
  ` }));
  await page.goto('http://127.0.0.1:4174/startup-gates.html');
  await page.waitForFunction(() => Boolean(window.__startupGateHarness));
  await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('required'); });
  const heading = page.getByRole('heading', { name: '初回利用の確認', exact: true });
  const checkbox = page.getByRole('checkbox', { name: '上記のデータ保存と利用目的を確認し、同意します。', exact: true });
  const accept = page.getByRole('button', { name: '同意して利用を開始する', exact: true });
  await expect(heading).toBeVisible();
  await expect(accept).toBeDisabled();
  await checkbox.check();
  const originalCheckbox = await checkbox.elementHandle();
  const originalDocument = await page.locator('html').elementHandle();
  const loads = await page.evaluate(() => sessionStorage.getItem('consent-navigation-loads'));
  for (const [path, title] of [['terms', '利用規約'], ['privacy', 'プライバシーポリシー']]) {
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(heading).toBeHidden();
    await page.goBack();
    await expect(heading).toBeVisible();
    await expect(checkbox).toBeChecked();
    await page.goForward();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
    await expect(heading).toBeVisible();
    await expect(checkbox).toBeChecked();
    expect(await originalDocument.evaluate(node => node === document.documentElement)).toBe(true);
    expect(await originalCheckbox.evaluate(node => node.isConnected && node.checked)).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('consent-navigation-loads'))).toBe(loads);
    expect(await page.evaluate(() => window.__consentNavigationAcceptCalls)).toBe(0);
    expect(await page.evaluate(() => window.__startupGateHarness.policy)).toBe('required');
    await expect(page.locator('.home-main')).toHaveCount(0);
  }
  await checkbox.uncheck();
  await expect(accept).toBeDisabled();
  await info.attach('initial-consent-after-legal-return', { body: await page.screenshot(), contentType: 'image/png' });
});
