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
