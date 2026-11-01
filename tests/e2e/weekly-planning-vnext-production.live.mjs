// Post-deploy production smoke for the VNext weekly-planning core (Issue #926).
// Runs only through the Live Account Browser Verification workflow (playwright.live.config.mjs,
// non-local https origin, existing secrets). Real provider calls are bounded per flow:
//   1+4 consultation only, then reload and a second chat (1 turn, no plan)
//   2   fixed-event registration preview on an isolated far-future date (1 turn, never saved)
//   3   plan with a splittable duration + a correction, approve, verify, clean up via the UI (2 turns)
// The D5 smoke cannot gate VNext: it reads V5 storage and Jev schema names.
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


const tag = `E2E-VNEXT-${process.env.GITHUB_RUN_ID?.trim() || Date.now()}`;

// Observes provider schemas and Firestore writes for one test; counts and classifications only.
function observe(page) {
  const seen = { schemas: [], forbidden: [], unclassified: 0 };
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/chat/completions')) {
      try { seen.schemas.push(request.postDataJSON()?.response_format?.json_schema?.name ?? 'none'); }
      catch { seen.schemas.push('unreadable'); }
    }
    if (url.hostname === 'firestore.googleapis.com') {
      const write = classifyFirestoreWrite({ url: request.url(), method: request.method(), postData: request.postData() });
      if (write?.classification === 'forbidden') seen.forbidden.push(write);
      if (write?.classification === 'unclassified') seen.unclassified++;
    }
  });
  return seen;
}
const assertProviderBound = (seen, maxCalls) => {
  expect(seen.schemas).toContain(VNEXT_SCHEMA);
  expect(seen.schemas.filter(name => V5_SEMANTIC_SCHEMAS.includes(name))).toEqual([]);
  expect(seen.schemas.length).toBeLessThanOrEqual(maxCalls);
};

const composer = page => page.locator('.ai-planning-composer textarea');
const assistantBubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
const userBubble = (page, text) => page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: text });

// One turn: send, wait for a new assistant bubble, and for the composer to be usable again.
async function sendTurn(page, text) {
  const baseline = await assistantBubbles(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => assistantBubbles(page).count(), { timeout: 120_000 }).toBeGreaterThan(baseline);
  await expect(userBubble(page, text)).toHaveCount(1);
  await expect(composer(page)).toBeEnabled({ timeout: 60_000 });
}

test.describe('VNext production core', () => {
  test.setTimeout(420_000);

  test('flow 1+4: consultation only, then reload and a second chat', async ({ page }) => {
    const seen = observe(page);
    await signIn(page);
    await openAiPlanning(page);
    const before = await readVNextStorage(page);
    const text = `英語の勉強法について相談したいです。計画はまだ作らず、アドバイスだけください。(${tag})`;
    await sendTurn(page, text);
    const after = await readVNextStorage(page);
    expect(after.vnextUiKeys).toBeGreaterThan(before.vnextUiKeys);
    expect(after.stableV5Keys).toBe(before.stableV5Keys);
    // Consultation never creates a preview, a draft block or a write.
    expect(after.previewSources).toEqual(before.previewSources);
    expect(after.draftBlocks).toBe(0);
    assertProviderBound(seen, MAX_TURN_PROVIDER_CALLS);
    expect(seen.forbidden).toEqual([]);

    // Flow 4: reload keeps the conversation without a provider call.
    const calls = seen.schemas.length;
    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
    await openAiPlanning(page);
    await expect(userBubble(page, text)).toHaveCount(1);
    // A second chat is independent; selecting the first chat restores its messages.
    await page.getByLabel('チャット一覧を開く').click();
    await page.getByRole('button', { name: '新しいチャット' }).click();
    await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
    await expect.poll(async () => (await readVNextStorage(page)).chats).toBeGreaterThanOrEqual(2);
    await page.getByLabel('チャット一覧を開く').click();
    await page.locator('.ai-chat-list').getByText('英語の勉強法').first().click();
    await expect(userBubble(page, text)).toHaveCount(1);
    expect(seen.schemas.length).toBe(calls);
    expect(seen.forbidden).toEqual([]);
  });

  test('flow 2: fixed-event registration previews only and saves nothing', async ({ page }) => {
    const seen = observe(page);
    await signIn(page);
    await openAiPlanning(page);
    const before = await readVNextStorage(page);
    const { month, day } = isolatedFutureDate();
    await sendTurn(page, `${month}月${day}日の10:30から12:00まで部活があります。その予定を登録したいです。`);
    const after = await readVNextStorage(page);
    expect(after.vnextUiKeys).toBeGreaterThan(before.vnextUiKeys);
    expect(after.vnextCoreKeys).toBeGreaterThan(0);
    expect(after.stableV5Keys).toBe(before.stableV5Keys);
    expect(after.previewSources).toContain('fixed_event_registration');
    expect(after.draftBlocks).toBe(0);
    assertProviderBound(seen, MAX_TURN_PROVIDER_CALLS);
    expect(seen.forbidden).toEqual([]);
  });

  test('flow 3: plan with a splittable duration and a correction, approve, verify, clean up', async ({ page }) => {
    const seen = observe(page);
    const title = `E2E-${tag}-読書`;
    let saved = false;
    let target = null;
    let primaryError = null;
    let cleanupError = null;
    try {
      await signIn(page);
      await openAiPlanning(page);
      // The target day must lie inside the week the AI planner is planning (selected date's week).
      const week = await plannerWeekStart(page);
      const plan = chooseTargetDay(week);
      target = plan.date;
      if (plan.switchWeek) {
        await openScheduleDay(page, plan.date);
        await openAiPlanning(page);
        await expect.poll(() => plannerWeekStart(page), { timeout: 30_000 }).toBe(plan.weekStart);
      }
      const when = `${target.getUTCMonth() + 1}月${target.getUTCDate()}日`;
      await sendTurn(page, `${when}の夜に「${title}」を合計90分したいです。30分ずつに分けても構いません。計画案を作ってください。`);
      await sendTurn(page, `訂正です。「${title}」は合計60分にしてください。`);
      const previewButton = page.locator('.ai-planning-preview-button').first();
      await expect(previewButton, 'a plan preview must exist after the correction').toBeVisible({ timeout: 30_000 });
      await previewButton.click();
      const dialog = page.locator('[role="dialog"]').filter({ hasText: 'この内容で仮予定にする' }).first();
      await expect(dialog).toBeVisible();
      // The correction must be reflected in the preview itself: blocks for the title total 60 minutes.
      const previewBlocks = dialog.locator('[data-ai-preview-action-block]');
      const previewMinutes = await shownMinutes(previewBlocks, title, /^(.*) (\d{2}:\d{2})-(\d{2}:\d{2})$/u, 'data-ai-preview-action-block');
      expect(previewMinutes, 'preview blocks for the title must total the corrected 60 minutes').toBe(60);
      await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
      await dialog.getByRole('button', { name: 'この内容で保存' }).click();
      saved = true;
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await openScheduleDay(page, target);
      await expect.poll(() => visibleEntries(page, title).count(), { timeout: 30_000 }).toBeGreaterThan(0);
      const savedMinutes = await shownMinutes(page.locator(`[title*="${title}"]`).locator('visible=true'), title,
        /^(.*?) \/ (\d{2}:\d{2})-(\d{2}:\d{2})(?: \/ .*)?$/u);
      expect(savedMinutes, 'saved entries for the title must total the corrected 60 minutes').toBe(60);
      assertProviderBound(seen, 2 * MAX_TURN_PROVIDER_CALLS);
    } catch (error) {
      primaryError = error;
    } finally {
      if (saved) {
        try { await removeSavedPlans(page, title, target); }
        catch (error) { cleanupError = error; }
      }
    }
    if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], 'VNext plan flow and its cleanup both failed.');
    if (primaryError) throw primaryError;
    if (cleanupError) throw cleanupError;
  });
});

const pad = value => String(value).padStart(2, '0');
const isoDay = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

// Reads the planner's current week start from the active chat's VNext checkpoint (counts/dates only).
const plannerWeekStart = page => page.evaluate(() => {
  const indexKey = Object.keys(localStorage).find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
  if (!indexKey) return null;
  let active;
  try { active = JSON.parse(localStorage.getItem(indexKey)).activeChatId; } catch { return null; }
  const key = Object.keys(localStorage).find(name => name.startsWith('studyplanner.weeklyPlanning.vnext.') && name.endsWith(`.${active}.ui`));
  try { return key ? JSON.parse(localStorage.getItem(key)).payload.state.weekStartDate : null; } catch { return null; }
});

// Tomorrow when it stays inside the planner's week; otherwise a later day (week start + 9 days, i.e.
// the third day) of the next week, with the planner switched to that week first.
function chooseTargetDay(weekStart) {
  expect(weekStart, 'the planner week must be readable from the checkpoint').toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  const start = new Date(`${weekStart}T00:00:00Z`);
  const tomorrow = jstTomorrow();
  const tomorrowUtcDay = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()));
  if (tomorrowUtcDay.getTime() <= addDays(start, 6).getTime() && tomorrowUtcDay.getTime() >= start.getTime()) {
    return { date: tomorrowUtcDay, switchWeek: false, weekStart };
  }
  const nextStart = addDays(start, 7);
  return { date: addDays(nextStart, 2), switchWeek: true, weekStart: isoDay(nextStart) };
}

// Sums the shown start-end minutes of entries for this title. Existence alone is not a correction check.
async function shownMinutes(locator, title, pattern, idAttribute) {
  const rows = await locator.evaluateAll((nodes, idAttr) => nodes.map(node => ({
    text: node.getAttribute('title') ?? '', id: idAttr ? node.getAttribute(idAttr) : null })), idAttribute ?? null);
  const seenIds = new Set();
  let total = 0;
  for (const row of rows) {
    if (row.id) { if (seenIds.has(row.id)) continue; seenIds.add(row.id); }
    const match = row.text.match(pattern);
    if (!match || !match[1].includes(title)) continue;
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    total += minutes(match[3]) - minutes(match[2]);
  }
  return total;
}

// Only visible nodes: the hidden AI view still holds the same title in its messages.
const visibleEntries = (page, title) => page.getByText(title).locator('visible=true');
function jstTomorrow() { return new Date(Date.now() + 9 * 3600_000 + 86_400_000); }

async function openScheduleDay(page, date) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  // The day view opens on the selected date (today by default); step forward until the target day shows.
  const label = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  const next = page.getByRole('button', { name: '次の期間へ' });
  for (let step = 0; step < 6 && !(await page.getByText(label).first().isVisible()); step++) await next.click();
}

// Deletes every saved block carrying this run's unique title through the schedule UI, then proves none remain.
async function removeSavedPlans(page, title, date) {
  await openScheduleDay(page, date);
  const entries = visibleEntries(page, title);
  for (let guard = 0; guard < 6 && (await entries.count()) > 0; guard++) {
    await entries.first().click();
    page.once('dialog', dialog => { void dialog.accept(); });
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await page.waitForTimeout(500);
  }
  await expect(entries).toHaveCount(0, { timeout: 30_000 });
}
