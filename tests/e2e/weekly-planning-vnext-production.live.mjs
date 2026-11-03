// Post-deploy production smoke for the VNext weekly-planning core (Issue #926).
// Runs only through the Live Account Browser Verification workflow (playwright.live.config.mjs,
// non-local https origin, existing secrets), against the real model. The flows themselves live in
// support/vnext-production-flows.mjs and run unchanged in CI on the durable emulator target
// (emulator/vnext-production.emulator.mjs), so what the page controls is proven before every deploy.
// Real provider calls are bounded per flow (see the flows module). The D5 smoke cannot gate VNext:
// it reads V5 storage and Jev schema names.
import { expect, test } from '@playwright/test';
import { fillSecret } from './support/fill-secret.mjs';
import { defineVNextProductionFlows } from './support/vnext-production-flows.mjs';

const requireSecret = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live-account verification.`);
  return value;
};
const liveEmail = requireSecret('STUDYPLANNER_LIVE_EMAIL');
const livePassword = requireSecret('STUDYPLANNER_LIVE_PASSWORD');
const liveAccessKey = process.env.STUDYPLANNER_LIVE_ACCESS_KEY?.trim() ?? '';

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  if (!(await nav.isVisible())) {
    const gate = page.getByRole('heading', { name: '限定公開キー' });
    const loginTab = page.getByRole('tab', { name: 'ログイン', exact: true });
    await expect.poll(async () => (await gate.isVisible()) || (await loginTab.isVisible()), { timeout: 20_000 }).toBe(true);
    if (await gate.isVisible()) {
      if (!liveAccessKey) throw new Error('The access gate is enabled, but STUDYPLANNER_LIVE_ACCESS_KEY is not configured.');
      await fillSecret(page.getByLabel('閲覧キー'), liveAccessKey, 'access key');
      await page.getByRole('button', { name: 'キーを確認して進む' }).click();
    }
    await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
    await fillSecret(page.getByLabel('メールアドレス'), liveEmail, 'email');
    await fillSecret(page.getByLabel('パスワード', { exact: true }), livePassword, 'password');
    await page.getByRole('button', { name: 'ログインする' }).click();
    const blocked = [page.getByRole('heading', { name: '初回利用の確認' }), page.getByRole('heading', { name: '1週間の始まりを選択' })];
    const authError = page.locator('.inline-error, .app-notice.error').first();
    await expect.poll(async () => (await nav.isVisible()) || (await authError.isVisible())
      || (await blocked[0].isVisible()) || (await blocked[1].isVisible()), { timeout: 30_000 }).toBe(true);
    if (await blocked[0].isVisible() || await blocked[1].isVisible()) {
      throw new Error('The live account still needs onboarding. Complete it manually before running this verification.');
    }
    if (await authError.isVisible()) throw new Error('Live-account sign-in failed (credentials not logged).');
  }
  await expect(nav).toBeVisible();
}

const tag = `E2E-VNEXT-${process.env.GITHUB_RUN_ID?.trim() || Date.now()}`;

defineVNextProductionFlows({ test, signIn, tag });
