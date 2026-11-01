// Post-deploy production smoke for the VNext weekly-planning core (Issue #926).
// Runs only through the Live Account Browser Verification workflow (playwright.live.config.mjs,
// non-local https origin, existing secrets). It sends ONE fixed-event utterance for an isolated
// far-future date, never approves or saves anything, and spends the real provider calls of that
// single turn. The D5 smoke cannot gate VNext: it reads V5 storage and Jev schema names.
import { expect, test } from '@playwright/test';
import { fillSecret } from './support/fill-secret.mjs';
import { classifyFirestoreWrite } from './support/d5-production-smoke-observation.mjs';

const requireSecret = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live-account verification.`);
  return value;
};
const liveEmail = requireSecret('STUDYPLANNER_LIVE_EMAIL');
const livePassword = requireSecret('STUDYPLANNER_LIVE_PASSWORD');
const liveAccessKey = process.env.STUDYPLANNER_LIVE_ACCESS_KEY?.trim() ?? '';

const VNEXT_SCHEMA = 'weekly_planning_vnext_native_v1';
const V5_SEMANTIC_SCHEMAS = ['weekly_planning_semantic_document_v5', 'weekly_planning_focused_contextual_answer_v5'];
const MAX_TURN_PROVIDER_CALLS = 6; // reading + bounded repair/choice + renderer; a runaway loop fails the run.

// A Monday about eight weeks ahead in Asia/Tokyo: far from the account's real weeks.
function isolatedFutureDate() {
  const jst = new Date(Date.now() + 9 * 3600_000 + 56 * 86_400_000);
  const dow = jst.getUTCDay();
  jst.setUTCDate(jst.getUTCDate() + ((8 - dow) % 7));
  return { month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}

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

const openAiPlanning = async page => {
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();
};

// Counts and keys only; never message bodies, ids or tokens leave the page.
const readVNextStorage = page => page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const ui = keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith('.ui'));
  const states = ui.map(key => { try { return JSON.parse(localStorage.getItem(key)).payload.state; } catch { return null; } });
  const index = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
  let chats = null;
  try { chats = index ? JSON.parse(localStorage.getItem(index)).chats.length : null; } catch { /* unreadable */ }
  return {
    vnextUiKeys: ui.length, vnextCoreKeys: keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith('.core')).length,
    stableV5Keys: keys.filter(key => key.includes('.weeklyPlanning.stableV5.')).length, chats,
    previewSources: states.flatMap(state => state?.previewCandidates?.map(candidate => candidate.source) ?? []),
    draftBlocks: states.reduce((sum, state) => sum + (state?.draftBlocks?.length ?? 0), 0),
  };
});

test('production serves VNext: fixed-event preview, no save, reload and multi-chat persistence', async ({ page }) => {
  const providerSchemas = [];
  const forbiddenWrites = [];
  let unclassifiedWrites = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/chat/completions')) {
      try { providerSchemas.push(request.postDataJSON()?.response_format?.json_schema?.name ?? 'none'); }
      catch { providerSchemas.push('unreadable'); }
    }
    if (url.hostname === 'firestore.googleapis.com') {
      const write = classifyFirestoreWrite({ url: request.url(), method: request.method(), postData: request.postData() });
      if (write?.classification === 'forbidden') forbiddenWrites.push(write);
      if (write?.classification === 'unclassified') unclassifiedWrites++;
    }
  });

  await signIn(page);
  await openAiPlanning(page);
  const before = await readVNextStorage(page);

  const { month, day } = isolatedFutureDate();
  const text = `${month}月${day}日の10:30から12:00まで部活があります。その予定を登録したいです。`;
  const composer = page.locator('.ai-planning-composer textarea');
  await composer.fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();

  // The turn is finished when an assistant bubble follows the user bubble and the composer is usable again.
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  const baselineAssistants = await assistant.count();
  await expect.poll(() => assistant.count(), { timeout: 120_000 }).toBeGreaterThan(baselineAssistants);
  await expect(page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: text })).toHaveCount(1);
  await expect(composer).toBeEnabled({ timeout: 60_000 });

  const after = await readVNextStorage(page);
  // The selected core is VNext: it persists its own checkpoint and never a V5 weekly slot.
  expect(after.vnextUiKeys).toBeGreaterThan(before.vnextUiKeys);
  expect(after.vnextCoreKeys).toBeGreaterThan(0);
  expect(after.stableV5Keys).toBe(before.stableV5Keys);
  // A fixed event request previews only; nothing becomes a draft block or a saved plan.
  expect(after.previewSources).toContain('fixed_event_registration');
  expect(after.draftBlocks).toBe(0);
  // One turn: VNext reading present, V5 semantic pipeline absent, bounded provider spend.
  expect(providerSchemas).toContain(VNEXT_SCHEMA);
  expect(providerSchemas.filter(name => V5_SEMANTIC_SCHEMAS.includes(name))).toEqual([]);
  expect(providerSchemas.length).toBeLessThanOrEqual(MAX_TURN_PROVIDER_CALLS);
  expect(forbiddenWrites).toEqual([]);
  test.info().annotations.push({ type: 'provider-calls', description: String(providerSchemas.length) },
    { type: 'unclassified-firestore-writes', description: String(unclassifiedWrites) });

  // Reload keeps the conversation (local VNext checkpoint, no provider call).
  const callsBeforeReload = providerSchemas.length;
  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
  await openAiPlanning(page);
  await expect(page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: text })).toHaveCount(1);

  // A second chat is independent and the first remains in the index.
  await page.getByLabel('チャット一覧を開く').click();
  await page.getByRole('button', { name: '新しいチャット' }).click();
  await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
  await expect.poll(async () => (await readVNextStorage(page)).chats).toBeGreaterThanOrEqual(2);
  expect(providerSchemas.length).toBe(callsBeforeReload);
  expect(forbiddenWrites).toEqual([]);
});
