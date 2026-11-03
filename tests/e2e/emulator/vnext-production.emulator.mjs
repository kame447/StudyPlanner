import { expect, test } from '../support/fixed-clock.mjs';
import { answerScriptedTurn } from '../support/synthetic-provider-client.mjs';
import { defineVNextProductionFlows } from '../support/vnext-production-flows.mjs';

// The VNext production smoke's flows (support/vnext-production-flows.mjs, also run by
// weekly-planning-vnext-production.live.mjs against production) on the durable emulator target: the real application
// build with durable turns on, the production Worker with its Durable Object job, the Auth and Firestore emulators,
// and the synthetic provider answering from the requests the Worker actually sends. The scripted readings are the only
// difference from production, where the real model answers; each is checked against the real VNext session in the unit
// suite's harness. The same helpers (storage contract, durable observation, day-view cleanup) therefore run in CI.
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

async function signIn(page) {
  await page.goto('/');
  const primaryNav = page.locator('.primary-bottom-nav');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(primaryNav.or(signInTab).first()).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
    await page.getByLabel('メールアドレス').fill(email());
    await page.getByLabel('パスワード', { exact: true }).fill(password());
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(primaryNav).toBeVisible();
}

// The last day (Sunday, JST) of the planner's week: tomorrow is outside it, so flow 3 must switch weeks.
const SUNDAY = new Date('2026-08-23T10:00:00+09:00');

defineVNextProductionFlows({
  test,
  signIn,
  tag: 'E2E-VNEXT-emulator',
  switchWeekClock: SUNDAY,
  beforeTurn: ({ request, ...turn }) => answerScriptedTurn(request, turn),
});
