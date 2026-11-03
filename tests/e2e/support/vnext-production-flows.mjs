import { expect } from '@playwright/test';
import { expectTurnPersisted, previewDialog, promoteThenSave, readVNextChatStorage } from './vnext-chat-storage.mjs';
import { expectDurableVNext, observeDurableTurns } from './vnext-durable-observation.mjs';
import { openScheduleDay, removeSavedPlansByTitle, sweepLeftoverPlans } from './schedule-plan-cleanup.mjs';
import { attachWriteLedger, cancellationCommitProblems, protectedWritesIn } from './vnext-firestore-writes.mjs';
import { assertKnownFlowOptions } from './vnext-flow-options.mjs';
import { addDays, chooseTargetDay, isoDay, keyForWeek, onlyWeek, weeksOf } from './vnext-planner-week.mjs';

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

const dayText = date => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;

const composer = page => page.locator('.ai-planning-composer textarea');
const assistantBubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
const userBubble = (page, text) => page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: text });

export const openAiPlanning = async page => {
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(composer(page)).toBeVisible();
};

// Firestore writes of the page, by phase (production and emulator hosts alike). Phases that must not write are the default;
// the sweep, the approved save and the cleanup are the only authorized ones (flow 3).
const observeFirestore = attachWriteLedger;
const expectNoUnauthorizedWrites = ledger => expect(ledger.violations()).toEqual([]);
const expectCancellationCommits = (ledger, phase, removed) => expect(cancellationCommitProblems(ledger.commitsIn(phase), removed), `${phase}: one cancellation commit per removed block`).toEqual([]);

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

// Key NAMES only (never values) plus the active chat id; the week readers below parse the names with the pure helpers.
const readKeys = page => page.evaluate(() => {
  const names = Object.keys(localStorage);
  const indexKey = names.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.') && !key.endsWith('.anonymous'));
  let active = null;
  try { active = indexKey ? JSON.parse(localStorage.getItem(indexKey)).activeChatId : null; } catch { /* unreadable */ }
  return { names, active };
});

// The planner's week from the active chat's `.ui` keys. The product keeps one per (week, chat), so this is only valid while
// the chat has exactly one (before any week change): with several it throws instead of picking one by order.
async function plannerWeekStart(page) {
  const { names, active } = await readKeys(page);
  return active ? onlyWeek(weeksOf(names, active, 'ui'), '.ui') : null;
}

// Weeks in which the active chat has an accepted turn (its `.core` keys).
async function coreWeeks(page) {
  const { names, active } = await readKeys(page);
  return active ? weeksOf(names, active, 'core') : [];
}

// Preview candidate dates stored in the active chat's `.ui` of an explicitly named week (dates only).
async function previewDates(page, week) {
  const { names, active } = await readKeys(page);
  const key = keyForWeek(names, active, week, 'ui');
  return page.evaluate(name => {
    try { return (JSON.parse(localStorage.getItem(name)).payload.state.previewCandidates ?? []).map(candidate => candidate.date); }
    catch { return []; }
  }, key);
}

// After a turn in the target week: the only accepted-turn week is the target's, and the preview is inside that week.
async function expectTurnInTargetWeek(page, target, { previewRequired }) {
  expect(await coreWeeks(page), 'the first accepted turn belongs to the target week and to no other').toEqual([target.weekStart]);
  const dates = await previewDates(page, target.weekStart);
  if (previewRequired) expect(dates.length, 'the turn produced a preview').toBeGreaterThan(0);
  const weekEnd = isoDay(addDays(new Date(`${target.weekStart}T00:00:00Z`), 6));
  expect(dates.filter(date => date < target.weekStart || date > weekEnd), 'every preview block lies in the target week').toEqual([]);
}

/**
 * Puts the AI planner on the week of a target day (tomorrow when it is inside the planner's week, else the third day of
 * the next one) and returns the target. Used by every flow that names a date, so a date outside the planner's week can
 * never be asked for. With `sweepLeftovers` the day view is visited first and earlier failed runs' plans are removed.
 */
export async function goToTargetPlannerWeek(page, { sweepLeftovers = false, plannerWeek = null, ledger = null } = {}) {
  // The planner's week is read only where it is unambiguous (before any week change) unless the caller names it.
  const week = plannerWeek ?? await plannerWeekStart(page);
  const nowMs = await page.evaluate(() => Date.now());
  const target = chooseTargetDay(week, nowMs);
  let visitedDayView = false;
  let swept = 0;
  if (sweepLeftovers) {
    // A failed earlier run left its plan on ITS target day, which was the day after its own date: sweep today through ours.
    const jstToday = new Date(nowMs + 9 * 3600_000);
    const today = new Date(Date.UTC(jstToday.getUTCFullYear(), jstToday.getUTCMonth(), jstToday.getUTCDate()));
    const dates = [];
    for (let day = today; day.getTime() <= target.date.getTime(); day = addDays(day, 1)) dates.push(day);
    const sweep = () => sweepLeftoverPlans(page, { titlePrefix: LEFTOVER_TITLE_PREFIX, dates });
    const removed = ledger ? await ledger.during('sweep', sweep) : await sweep();
    if (ledger) expectCancellationCommits(ledger, 'sweep', removed);
    swept = removed;
    if (removed > 0) console.warn(`Removed ${removed} leftover ${LEFTOVER_TITLE_PREFIX} plan title(s) from an earlier failed run.`);
    visitedDayView = true;
  } else if (target.switchWeek) {
    await openScheduleDay(page, target.date);
    visitedDayView = true;
  }
  // The planner follows the selected day's week (the day view ends on the target day); the first turn's week is checked
  // after it (expectTurnInTargetWeek), because a fresh week has no `.ui` of its own to read before a turn.
  if (visitedDayView) await openAiPlanning(page);
  return { ...target, iso: isoDay(target.date), text: dayText(target.date), swept };
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

// Selects the day seven days before today in the schedule's day view: the AI planner works on the selected date's week,
// and the week of today - 7 always ends before tomorrow.
async function selectDayOfPreviousWeek(page, expectedPlannerWeek) {
  const nowMs = await page.evaluate(() => Date.now());
  const jst = new Date(nowMs + 9 * 3600_000 - 7 * 86_400_000);
  const day = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const previous = page.getByRole('button', { name: '前の期間へ' });
  for (let step = 0; step < 7; step++) await previous.click();
  // Observed, not assumed: the day view shows that day, and the planner has moved to its week (its own `.ui` exists).
  await expect(page.getByText(dayText(day)).first()).toBeVisible();
  await expect.poll(async () => {
    const { names, active } = await readKeys(page);
    return active ? weeksOf(names, active, 'ui').includes(expectedPlannerWeek) : false;
  }, { message: 'the planner moved to the previous week', timeout: 30_000 }).toBe(true);
}

// Saved plan blocks of this title on the open schedule day (titles render as '<title> <n>分', DayTimeline.tsx).
const countSavedBlocks = (page, title) => page.locator('.timeline-plan-block:not(.timeline-draft-block)').evaluateAll(
  (nodes, name) => nodes.filter(node => (node.getAttribute('title') ?? '').startsWith(`${name} `)).length, title);

// Only visible nodes: the hidden AI view still holds the same title in its messages.
const visibleEntries = (page, title) => page.getByText(title).locator('visible=true');

/**
 * Registers the three flows (and, with `exerciseWeekSwitch`, a fourth that runs flow 3 after selecting a day of the PREVIOUS
 * week in the schedule view, so tomorrow lies outside the planner's week and the week-switching branch must be taken).
 * The clock is never moved: the durable Worker refuses a turn whose browser start time is not near its own (durableTurnJob.ts
 * expired_request), so both run on real time. `test` is Playwright's;
 * `signIn(page)` ends on the signed-in app; `tag` makes titles unique per run.
 */
export function defineVNextProductionFlows(options) {
  const { test, signIn, tag, beforeTurn, exerciseWeekSwitch = false } = assertKnownFlowOptions(options);
  // The scripted emulator stack (beforeTurn) always leaves an earlier run's plan for the sweep and always requires it removed;
  // production has no such seed (a leftover may not exist) but still checks the commits of whatever the sweep removes.
  const seedEarlierRun = Boolean(beforeTurn);
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
      expectNoUnauthorizedWrites(firestore);

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
      expectNoUnauthorizedWrites(firestore);
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
      await expectTurnInTargetWeek(page, target, { previewRequired: true });
      const after = await readVNextChatStorage(page, text);
      expectTurnPersisted(before, after);
      expect(after.stableV5Keys).toBe(before.stableV5Keys);
      expect(after.previewSources).toContain('fixed_event_registration');
      await expect(page.locator('.ai-planning-plan-card'), 'the registration preview is offered in the chat').toBeVisible();
      expect(after.draftBlocks).toBe(0);
      await expectDurableVNext(durable, { turns: 1 });
      expectNoUnauthorizedWrites(firestore);
    });

    // Two turns (90 minutes, then the correction to 60), the preview check and the approved save, inside the flow's own `save` phase.
    async function planAndSave(page, request, firestore, target, title) {
      await sendTurn(page, `${target.text}の夜に「${title}」を合計90分したいです。30分ずつに分けても構いません。計画案を作ってください。`,
        scripted(request, { kind: 'plan', title, date: target.iso }));
      await expectTurnInTargetWeek(page, target, { previewRequired: false });
      await sendTurn(page, `訂正です。「${title}」は合計60分にしてください。`,
        scripted(request, { kind: 'correction', title, date: target.iso }));
      await expectTurnInTargetWeek(page, target, { previewRequired: true });
      const previewButton = page.locator('.ai-planning-preview-button').first();
      await expect(previewButton, 'a plan preview must exist after the correction').toBeVisible({ timeout: 30_000 });
      await previewButton.click();
      const dialog = previewDialog(page);
      await expect(dialog).toBeVisible();
      // The correction must be reflected in the preview itself: blocks for the title total 60 minutes.
      const previewMinutes = await shownMinutes(dialog.locator('[data-ai-preview-action-block]'), title,
        /^(.*) (\d{2}:\d{2})-(\d{2}:\d{2})$/u, 'data-ai-preview-action-block');
      expect(previewMinutes, 'preview blocks for the title must total the corrected 60 minutes').toBe(60);
      return dialog;
    }

    // The emulator account starts empty, so the leftover sweep would find nothing. An earlier run's plan is left behind here, in
    // its own browser context before the flow's page signs in, so the sweep must remove it and its write is observed and checked.
    async function leaveEarlierRunsPlan(browser, request) {
      // A manually created context does not inherit the project's options: pass the ones the page depends on.
      const { baseURL, storageState, timezoneId, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale } = test.info().project.use;
      const context = await browser.newContext({ baseURL, storageState, timezoneId, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale });
      try {
        const page = await context.newPage();
        const firestore = observeFirestore(page);
        const title = `E2E-${tag}-前回の残り`;
        await signIn(page);
        await openAiPlanning(page);
        const target = await goToTargetPlannerWeek(page);
        const dialog = await planAndSave(page, request, firestore, target, title);
        await firestore.during('save', async () => {
          await promoteThenSave(dialog);
          await expect(dialog).toBeHidden({ timeout: 60_000 });
        });
        expect(protectedWritesIn(firestore.inPhase('save'))).not.toEqual([]);
        await openScheduleDay(page, target.date);
        await expect.poll(() => visibleEntries(page, title).count(), { timeout: 30_000 }).toBeGreaterThan(0);
        expectNoUnauthorizedWrites(firestore);
      } finally { await context.close(); }
    }

    const planFlow = (name, { week = false } = {}) => test(name, async ({ page, request, browser }) => {
      const firestore = observeFirestore(page);
      const durable = observeDurableTurns(page);
      const title = `E2E-${tag}-読書`;
      let attemptedSave = false;
      let savedBlocks = null; // observed on the schedule day view once the plan is saved
      let target = null;
      let primaryError = null;
      let cleanupError = null;
      try {
        if (seedEarlierRun && !week) await leaveEarlierRunsPlan(browser, request);
        await signIn(page);
        await openAiPlanning(page);
        // The planner's own week, read while it has a single `.ui` (before any week change).
        let plannerWeek = null;
        if (week) {
          const current = await plannerWeekStart(page);
          plannerWeek = isoDay(addDays(new Date(`${current}T00:00:00Z`), -7));
          await selectDayOfPreviousWeek(page, plannerWeek);
        }
        // Earlier failed runs' plans are removed first, then the planner is put on the target day's week.
        target = await goToTargetPlannerWeek(page, { sweepLeftovers: true, plannerWeek, ledger: firestore });
        if (week) expect(target.switchWeek, 'this case must take the week-switching branch').toBe(true);
        if (seedEarlierRun && !week) expect(target.swept, 'the sweep removes the plan an earlier run left behind').toBeGreaterThan(0);
        const dialog = await planAndSave(page, request, firestore, target, title);
        attemptedSave = true; // the save click may write even when a later wait fails: cleanup must then still run
        // The approved save is the one authorized write of the flow; the observer must see it (a blind observer proves nothing).
        await firestore.during('save', async () => {
          await promoteThenSave(dialog);
          await expect(dialog).toBeHidden({ timeout: 60_000 });
        });
        expect(protectedWritesIn(firestore.inPhase('save')), 'the approved save writes to a protected collection, seen by the observer').not.toEqual([]);
        await openScheduleDay(page, target.date);
        await expect.poll(() => visibleEntries(page, title).count(), { timeout: 30_000 }).toBeGreaterThan(0);
        savedBlocks = await countSavedBlocks(page, title);
        const savedMinutes = await shownMinutes(page.locator(`[title*="${title}"]`).locator('visible=true'), title,
          /^(.*?) \/ (\d{2}:\d{2})-(\d{2}:\d{2})(?: \/ .*)?$/u);
        expect(savedMinutes, 'saved entries for the title must total the corrected 60 minutes').toBe(60);
        await expectDurableVNext(durable, { turns: 2 });
        expectNoUnauthorizedWrites(firestore);
      } catch (error) {
        primaryError = error;
      } finally {
        if (attemptedSave) {
          try {
            // Exactly the blocks observed saved are removed and none remain; when the save never became visible nothing may be found.
            const removed = await firestore.during('cleanup', () => removeSavedPlansByTitle(page, { title, date: target.date, allowNone: savedBlocks === null }));
            expect(removed, 'cleanup removes exactly the saved blocks').toBe(savedBlocks ?? removed);
            // Each removed block is one cancellation commit. The occurrence is cancelled, not deleted, and the page exposes no
            // persisted copy of it, so besides 0 visible blocks (checked by the helper) the evidence is that commit.
            expectCancellationCommits(firestore, 'cleanup', removed);
            expectNoUnauthorizedWrites(firestore);
          } catch (error) { cleanupError = error; }
        }
      }
      if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], 'VNext plan flow and its cleanup both failed.');
      if (primaryError) throw primaryError;
      if (cleanupError) throw cleanupError;
    });
    planFlow('flow 3: plan with a splittable duration and a correction, approve, verify, clean up');
    if (exerciseWeekSwitch) planFlow('flow 3 with the planner on the previous week: it switches to the target week', { week: true });
  });
}
