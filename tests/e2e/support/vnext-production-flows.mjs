import { expect } from '@playwright/test';
import { expectTurnPersisted, previewDialog, promoteThenSave, readVNextChatStorage } from './vnext-chat-storage.mjs';
import { expectDurableVNext, observeDurableTurns } from './vnext-durable-observation.mjs';
import { openScheduleDay, removeSavedPlansByTitle, sweepLeftoverPlans } from './schedule-plan-cleanup.mjs';
import { classifyFirestoreWrite } from './d5-production-smoke-observation.mjs';

// The VNext production flows (Issue #926), defined once and run by BOTH the production smoke (real model, live account,
// weekly-planning-vnext-production.live.mjs) and the CI emulator (durable Worker + synthetic provider,
// emulator/vnext-production.emulator.mjs). Everything the page controls (storage, dialog, chat list, week switching, day
// view, cleanup control, durable observation) therefore runs before every deploy; only the model's reading is production-only.
//
//   1+4 consultation only, then reload and a second chat (1 turn, no plan)
//   2   fixed-event registration previews only on a day inside the planner's week (1 turn, never saved)
//   3   plan with a splittable duration and a correction, approve, verify, clean up through the day view (2 turns)
//
// `beforeTurn({ request, kind, title, date })` is optional: the emulator answers the turn's provider calls from it. It is
// started before the user sends, and awaited after the turn completes.
export const LEFTOVER_TITLE_PREFIX = 'E2E-E2E-VNEXT-';

const pad = value => String(value).padStart(2, '0');
const isoDay = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const dayText = date => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;

const composer = page => page.locator('.ai-planning-composer textarea');
const assistantBubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
const userBubble = (page, text) => page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: text });

export const openAiPlanning = async page => {
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(composer(page)).toBeVisible();
};

// Counts and classifications of Firestore writes made by the page; nothing else is recorded.
function observeFirestore(page) {
  const seen = { forbidden: [], unclassified: 0 };
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== 'firestore.googleapis.com') return;
    const write = classifyFirestoreWrite({ url: request.url(), method: request.method(), postData: request.postData() });
    if (write?.classification === 'forbidden') seen.forbidden.push(write);
    if (write?.classification === 'unclassified') seen.unclassified++;
  });
  return seen;
}

// One turn: start the optional scripted answers, send, wait for a new assistant bubble and a usable composer.
async function sendTurn(page, text, scripted) {
  const run = Promise.resolve(scripted?.());
  run.catch(() => undefined); // surfaced below once the page side has finished; never an unhandled rejection
  const baseline = await assistantBubbles(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => assistantBubbles(page).count(), { timeout: 120_000 }).toBeGreaterThan(baseline);
  await expect(userBubble(page, text)).toHaveCount(1);
  await expect(composer(page)).toBeEnabled({ timeout: 60_000 });
  await run;
}

// The planner's current week start, from the active chat's VNext checkpoint (a date only).
const plannerWeekStart = page => page.evaluate(() => {
  const indexKey = Object.keys(localStorage).find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.') && !key.endsWith('.anonymous'));
  if (!indexKey) return null;
  let active;
  try { active = JSON.parse(localStorage.getItem(indexKey)).activeChatId; } catch { return null; }
  const key = Object.keys(localStorage).find(name => name.startsWith('studyplanner.weeklyPlanning.vnext.')
    && !name.includes('.anonymous.') && name.endsWith(`.${active}.ui`));
  try { return key ? JSON.parse(localStorage.getItem(key)).payload.state.weekStartDate : null; } catch { return null; }
});

// Tomorrow (in Asia/Tokyo, by the BROWSER's clock: fixed in the emulator) when it stays inside the planner's week;
// otherwise the third day of the next week, with the planner switched to that week first.
function chooseTargetDay(weekStart, browserNowMs) {
  expect(weekStart, 'the planner week must be readable from the checkpoint').toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  const start = new Date(`${weekStart}T00:00:00Z`);
  const tomorrow = new Date(browserNowMs + 9 * 3600_000 + 86_400_000);
  const tomorrowDay = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()));
  if (tomorrowDay.getTime() >= start.getTime() && tomorrowDay.getTime() <= addDays(start, 6).getTime()) {
    return { date: tomorrowDay, switchWeek: false, weekStart };
  }
  const nextStart = addDays(start, 7);
  return { date: addDays(nextStart, 2), switchWeek: true, weekStart: isoDay(nextStart) };
}

/**
 * Puts the AI planner on the week of a target day (tomorrow when it is inside the planner's week, else the third day of
 * the next one) and returns the target. Used by every flow that names a date, so a date outside the planner's week can
 * never be asked for. With `sweepLeftovers` the day view is visited first and earlier failed runs' plans are removed.
 */
export async function goToTargetPlannerWeek(page, { sweepLeftovers = false } = {}) {
  const week = await plannerWeekStart(page);
  const nowMs = await page.evaluate(() => Date.now());
  const target = chooseTargetDay(week, nowMs);
  let visitedDayView = false;
  if (sweepLeftovers) {
    // A failed earlier run left its plan on ITS target day, which was the day after its own date: sweep today through ours.
    const jstToday = new Date(nowMs + 9 * 3600_000);
    const today = new Date(Date.UTC(jstToday.getUTCFullYear(), jstToday.getUTCMonth(), jstToday.getUTCDate()));
    const dates = [];
    for (let day = today; day.getTime() <= target.date.getTime(); day = addDays(day, 1)) dates.push(day);
    const removed = await sweepLeftoverPlans(page, { titlePrefix: LEFTOVER_TITLE_PREFIX, dates });
    if (removed > 0) console.warn(`Removed ${removed} leftover ${LEFTOVER_TITLE_PREFIX} plan title(s) from an earlier failed run.`);
    visitedDayView = true;
  } else if (target.switchWeek) {
    await openScheduleDay(page, target.date);
    visitedDayView = true;
  }
  if (visitedDayView) {
    await openAiPlanning(page);
    await expect.poll(() => plannerWeekStart(page), { timeout: 30_000 }).toBe(target.weekStart);
  }
  return { ...target, iso: isoDay(target.date), text: dayText(target.date) };
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

/**
 * Registers the three flows (and, when `switchWeekClock` is a Date, a fourth that runs flow 3 with the clock set there,
 * which must take the week-switching branch). `test` is Playwright's (the emulator passes its fixed-clock one);
 * `signIn(page)` ends on the signed-in app; `tag` makes titles unique per run.
 */
export function defineVNextProductionFlows({ test, signIn, tag, beforeTurn, switchWeekClock = null }) {
  const scripted = (request, turn) => (beforeTurn ? () => beforeTurn({ request, ...turn }) : undefined);

  test.describe('VNext production core', () => {
    test.setTimeout(420_000);

    test('flow 1+4: consultation only, then reload and a second chat', async ({ page, request }) => {
      const firestore = observeFirestore(page);
      const durable = observeDurableTurns(page);
      await signIn(page);
      await openAiPlanning(page);
      const text = `英語の勉強法について相談したいです。計画はまだ作らず、アドバイスだけください。(${tag})`;
      const before = await readVNextChatStorage(page, text);
      await sendTurn(page, text, scripted(request, { kind: 'consultation', title: null, date: null }));
      const after = await readVNextChatStorage(page, text);
      expectTurnPersisted(before, after);
      expect(after.stableV5Keys).toBe(before.stableV5Keys);
      // Consultation never creates a preview, a draft block or a write.
      expect(after.previewSources).toEqual(before.previewSources);
      expect(after.draftBlocks).toBe(0);
      await expectDurableVNext(durable, { turns: 1 });
      expect(firestore.forbidden).toEqual([]);

      // Flow 4: reload keeps the conversation and makes no new durable call.
      const calls = await durable.observedCalls();
      const posts = durable.seen.durablePosts;
      await page.reload();
      await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
      await openAiPlanning(page);
      await expect(userBubble(page, text)).toHaveCount(1);
      // The reload restores exactly what the turn persisted.
      expect((await readVNextChatStorage(page, text)).messages).toBe(after.messages);
      // A second chat is independent; selecting the first chat restores its messages.
      await page.getByLabel('チャット一覧を開く').click();
      await page.getByRole('button', { name: '新しいチャット', exact: true }).click();
      await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
      await expect.poll(async () => (await readVNextChatStorage(page)).chats).toBeGreaterThanOrEqual(2);
      await page.getByLabel('チャット一覧を開く').click();
      await page.locator('.ai-chat-list').getByText('英語の勉強法').first().click();
      await expect(userBubble(page, text)).toHaveCount(1);
      expect(await durable.observedCalls(), 'reload and chat switching make no provider call').toBe(calls);
      expect(durable.seen.durablePosts, 'reload and chat switching submit no durable turn').toBe(posts);
      expect(firestore.forbidden).toEqual([]);
    });

    test('flow 2: fixed-event registration previews only and saves nothing', async ({ page, request }) => {
      const firestore = observeFirestore(page);
      const durable = observeDurableTurns(page);
      await signIn(page);
      await openAiPlanning(page);
      // The registration projection runs on the planner's week, so the day must lie inside it.
      const target = await goToTargetPlannerWeek(page);
      const text = `${target.text}の10:30から12:00まで部活があります。その予定を登録したいです。`;
      const before = await readVNextChatStorage(page, text);
      await sendTurn(page, text, scripted(request, { kind: 'registration', title: '部活', date: target.iso }));
      const after = await readVNextChatStorage(page, text);
      expectTurnPersisted(before, after);
      expect(after.stableV5Keys).toBe(before.stableV5Keys);
      expect(after.previewSources).toContain('fixed_event_registration');
      await expect(page.locator('.ai-planning-plan-card'), 'the registration preview is offered in the chat').toBeVisible();
      expect(after.draftBlocks).toBe(0);
      await expectDurableVNext(durable, { turns: 1 });
      expect(firestore.forbidden).toEqual([]);
    });

    const planFlow = (name, { week = false } = {}) => test(name, async ({ page, request, context }) => {
      if (week) await context.clock.setSystemTime(switchWeekClock);
      const firestore = observeFirestore(page);
      const durable = observeDurableTurns(page);
      const title = `E2E-${tag}-読書`;
      let attemptedSave = false;
      let target = null;
      let primaryError = null;
      let cleanupError = null;
      try {
        await signIn(page);
        await openAiPlanning(page);
        // Earlier failed runs' plans are removed first, then the planner is put on the target day's week.
        target = await goToTargetPlannerWeek(page, { sweepLeftovers: true });
        if (week) expect(target.switchWeek, 'this case must take the week-switching branch').toBe(true);
        await sendTurn(page, `${target.text}の夜に「${title}」を合計90分したいです。30分ずつに分けても構いません。計画案を作ってください。`,
          scripted(request, { kind: 'plan', title, date: target.iso }));
        await sendTurn(page, `訂正です。「${title}」は合計60分にしてください。`,
          scripted(request, { kind: 'correction', title, date: target.iso }));
        const previewButton = page.locator('.ai-planning-preview-button').first();
        await expect(previewButton, 'a plan preview must exist after the correction').toBeVisible({ timeout: 30_000 });
        await previewButton.click();
        const dialog = previewDialog(page);
        await expect(dialog).toBeVisible();
        // The correction must be reflected in the preview itself: blocks for the title total 60 minutes.
        const previewMinutes = await shownMinutes(dialog.locator('[data-ai-preview-action-block]'), title,
          /^(.*) (\d{2}:\d{2})-(\d{2}:\d{2})$/u, 'data-ai-preview-action-block');
        expect(previewMinutes, 'preview blocks for the title must total the corrected 60 minutes').toBe(60);
        attemptedSave = true; // the save click may write even when a later wait fails: cleanup must then still run
        await promoteThenSave(dialog);
        await expect(dialog).toBeHidden({ timeout: 60_000 });
        await openScheduleDay(page, target.date);
        await expect.poll(() => visibleEntries(page, title).count(), { timeout: 30_000 }).toBeGreaterThan(0);
        const savedMinutes = await shownMinutes(page.locator(`[title*="${title}"]`).locator('visible=true'), title,
          /^(.*?) \/ (\d{2}:\d{2})-(\d{2}:\d{2})(?: \/ .*)?$/u);
        expect(savedMinutes, 'saved entries for the title must total the corrected 60 minutes').toBe(60);
        await expectDurableVNext(durable, { turns: 2 });
        expect(firestore.forbidden).toEqual([]);
      } catch (error) {
        primaryError = error;
      } finally {
        if (attemptedSave) {
          try { await removeSavedPlansByTitle(page, { title, date: target.date }); }
          catch (error) { cleanupError = error; }
        }
      }
      if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], 'VNext plan flow and its cleanup both failed.');
      if (primaryError) throw primaryError;
      if (cleanupError) throw cleanupError;
    });
    planFlow('flow 3: plan with a splittable duration and a correction, approve, verify, clean up');
    if (switchWeekClock) planFlow('flow 3 on the last day of the planner week: the planner switches to the next week', { week: true });
  });
}
