import { expect, test } from '@playwright/test';
import { answerScriptedTurn } from '../support/synthetic-provider-client.mjs';
import { defineVNextProductionFlows } from '../support/vnext-production-flows.mjs';

// Real clock: the durable Worker refuses a turn whose browser start time is not within minutes of its own, so this
// target cannot use the fixed past clock of the other emulator specs. Flows derive their dates from the browser clock.
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

defineVNextProductionFlows({
  test,
  signIn,
  tag: 'E2E-VNEXT-emulator',
  exerciseWeekSwitch: true,
  beforeTurn: ({ request, ...turn }) => answerScriptedTurn(request, turn),
});
