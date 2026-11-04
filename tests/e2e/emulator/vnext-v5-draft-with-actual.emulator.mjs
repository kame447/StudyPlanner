import { expect, test } from '@playwright/test';
import { answer, nextCall, VNEXT_READING_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { scriptedActualReading, WEEK_RECORDS, WEEK_TOTAL_MINUTES } from '../support/vnext-actual-readings.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5.ts';
import { createInitialPlanningState } from '../../../src/features/weeklyPlanning/weeklyPlanningReducer.ts';
import {
  largestWeeklyPlanningStableV5Checkpoint, prepareWeeklyPlanningStableV5Checkpoint, weeklyPlanningStableV5StorageKey,
} from '../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5SessionCodec.ts';

const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;
const isoDay = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const text = field => field?.stringValue ?? null;

function previousWeekOf(nowMs) {
  const jst = new Date(nowMs + 9 * 3600_000);
  const today = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const monday = addDays(today, -((today.getUTCDay() + 6) % 7) - 7);
  return Array.from({ length: 7 }, (_, index) => isoDay(addDays(monday, index)));
}

function editedV5Checkpoint(ownerId, week) {
  const conversationId = 'c1-compound-v5-conversation';
  const now = new Date().toISOString();
  const block = {
    id: 'c1-compound-edited-draft', userId: ownerId, date: week[3], startTime: '10:00', endTime: '10:30',
    title: '英単語 30分', subject: '英単語', type: 'study', label: '英単語',
    memo: '利用者が変更した未保存の仮予定', source: 'ai', status: 'draft', userEdited: true,
    createdAt: now, updatedAt: now,
    behaviorMetadata: {
      conversationId, stateRevision: 0, sourceFactRefs: [], usedAssumptionProposalRefs: [],
      taskRef: 'v5-task', opportunityTags: [], reasoningKey: 'stable-v5-explicit-duration',
      compatibility: { workItemSemantic: 'generic_semantic_task', schedulerInputSource: 'stable_v5_generic_scheduler_input', candidateSource: 'stable_v5' },
      previewMetadata: { previewId: 'stable-v5-preview', conversationId, stateRevision: 0,
        assumptionDependencies: [], approvalEligibility: 'eligible', stale: false, authorizedUserId: ownerId },
    },
  };
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const planningState = { ...createInitialPlanningState(week[0]), mode: 'awaiting_approval',
    draftBlocks: [block], previewCandidates: [], messages: [{
      id: 'c1-compound-message', role: 'user', content: '英単語を30分進めたい', createdAt: now,
    }] };
  const prepared = prepareWeeklyPlanningStableV5Checkpoint({
    ownerId, weekStartDate: week[0], conversationId, graph, planningState,
  });
  expect(prepared.status).toBe('ready');
  const checkpoint = largestWeeklyPlanningStableV5Checkpoint({
    ownerId, weekStartDate: week[0], conversationId, graph, planningState: prepared.planningState, savedAt: now,
  });
  expect(checkpoint).not.toBeNull();
  return checkpoint.raw;
}

async function signInAndOpenAi(page) {
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  const nav = page.locator('.primary-bottom-nav');
  await expect(nav.or(signInTab).first()).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
    await page.getByLabel('メールアドレス').fill(email());
    await page.getByLabel('パスワード', { exact: true }).fill(password());
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(nav).toBeVisible();
  await openAiPlanning(page);
}

async function activeDraft(page, ownerId, weekStart) {
  return page.evaluate(({ ownerId, weekStart }) => {
    const index = JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${ownerId}`) ?? 'null');
    if (!index?.activeChatId) return null;
    const raw = localStorage.getItem(`studyplanner.weeklyPlanning.vnext.${ownerId}.${weekStart}.${index.activeChatId}.ui`);
    return raw ? JSON.parse(raw).payload?.state?.draftBlocks?.[0] ?? null : null;
  }, { ownerId, weekStart });
}

async function activeChatId(page, ownerId) {
  return page.evaluate(owner => JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${owner}`) ?? 'null')?.activeChatId ?? null, ownerId);
}

async function actualDocuments(request, ownerId) {
  const response = await request.get(`${FIRESTORE}/actuals?pageSize=300`, { headers: OWNER });
  expect(response.ok()).toBe(true);
  return ((await response.json()).documents ?? [])
    .map(({ name, fields = {} }) => ({
      docId: name.split('/').pop(), userId: text(fields.userId), date: text(fields.occurrenceDate),
      subject: text(fields.subject), minutes: fields.actualDurationMinutes?.integerValue === undefined
        ? null : Number(fields.actualDurationMinutes.integerValue),
    }))
    .filter(record => record.userId === ownerId)
    .sort((a, b) => `${a.date}${a.subject}${a.docId}`.localeCompare(`${b.date}${b.subject}${b.docId}`));
}

async function ownerEvents(request, ownerId) {
  const response = await request.get(`${FIRESTORE}/schedule_events?pageSize=300`, { headers: OWNER });
  expect(response.ok()).toBe(true);
  return ((await response.json()).documents ?? []).filter(document => document.fields?.userId?.stringValue === ownerId);
}

async function sendActualWeek(page, request, week) {
  const run = (async () => {
    const reading = await nextCall(request);
    expect(reading.schema).toBe(VNEXT_READING_SCHEMA);
    await answer(request, reading, scriptedActualReading('actual_week', { week }));
  })();
  run.catch(() => undefined);
  const bubbles = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  const before = await bubbles.count();
  await page.locator('.ai-planning-composer textarea').fill(
    '先週の勉強をまとめて記録したいです。月曜は数学を60分、火曜は英語を45分、水曜は現代文を30分、木曜は休みでした。金曜は英語を50分、土曜は数学を120分、日曜は化学を90分やりました。');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => bubbles.count()).toBeGreaterThan(before);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  await run;
}

test('C1 compound UI: migrated V5 draft stays separate from pending and saved actuals', async ({ page, request }) => {
  const ownerId = await emulatorUserId(request, { email: email(), password: password() });
  for (const record of await actualDocuments(request, ownerId)) {
    const removed = await request.delete(`${FIRESTORE}/actuals/${record.docId}`, { headers: OWNER });
    expect(removed.ok()).toBe(true);
  }
  const writes = attachWriteLedger(page);
  // C1 migrates the weekly V5 slot on the first VNext load, for the week that load opens (the
  // current week). Study records are for last week and are accepted from the same conversation.
  const week = previousWeekOf(Date.now());
  const current = week.map(day => isoDay(addDays(new Date(`${day}T00:00:00Z`), 7)));
  const v5Key = weeklyPlanningStableV5StorageKey(ownerId, current[0]);
  const v5Raw = editedV5Checkpoint(ownerId, current);
  await page.addInitScript(({ key, raw }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, raw); }, { key: v5Key, raw: v5Raw });
  await page.goto('/');
  expect(previousWeekOf(await page.evaluate(() => Date.now()))).toEqual(week);

  const neighbourIds = ['c1-compound-other-week', 'c1-compound-other-owner'];
  const neighbours = [
    { id: neighbourIds[0], userId: ownerId, date: isoDay(addDays(new Date(`${week[0]}T00:00:00Z`), -1)) },
    { id: neighbourIds[1], userId: 'c1-compound-other-user', date: week[0] },
  ];
  for (const neighbour of neighbours) {
    const seeded = await request.patch(`${FIRESTORE}/actuals/${neighbour.id}`, {
      headers: OWNER, data: { fields: {
        id: { stringValue: neighbour.id }, userId: { stringValue: neighbour.userId },
        planId: { nullValue: null }, occurrenceDate: { stringValue: neighbour.date },
        subject: { stringValue: '物理' }, title: { stringValue: '物理の勉強' },
        actualDurationMinutes: { integerValue: '25' },
      } },
    });
    expect(seeded.ok()).toBe(true);
  }
  const neighbourBefore = await Promise.all(neighbourIds.map(async id => {
    const response = await request.get(`${FIRESTORE}/actuals/${id}`, { headers: OWNER });
    expect(response.ok()).toBe(true);
    return response.json();
  }));
  const eventsBefore = await ownerEvents(request, ownerId);

  await signInAndOpenAi(page);
  await expect(page.locator('.ai-planning-plan-card').first()).toContainText('1件');
  await expect.poll(() => activeDraft(page, ownerId, current[0])).toMatchObject({
    id: 'c1-compound-edited-draft', status: 'draft', userEdited: true,
  });
  const migratedChatId = await activeChatId(page, ownerId);
  expect(migratedChatId).toBeTruthy();
  await sendActualWeek(page, request, week);
  expect(await activeChatId(page, ownerId)).toBe(migratedChatId);
  const planCard = page.locator('.ai-planning-plan-card').filter({ has: page.getByRole('button', { name: '計画プレビューを確認' }) });
  const actualCard = page.locator('.ai-planning-actual-card');
  await expect(planCard).toBeVisible();
  await expect(actualCard).toContainText('6件');
  await expect(planCard.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
  await expect(actualCard.getByRole('button', { name: '実績を確認' })).toBeVisible();
  expect(await actualDocuments(request, ownerId)).toEqual(
    expect.arrayContaining([expect.objectContaining({ docId: neighbourIds[0] })]));
  expect((await actualDocuments(request, ownerId)).filter(record => week.includes(record.date))).toEqual([]);
  expect(protectedWritesIn(writes.writes()), 'plans, actuals and approvals have no write before confirmation').toEqual([]);

  await planCard.getByRole('button', { name: '計画プレビューを確認' }).click();
  const planDialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(planDialog.locator('.ai-planning-draft-block').first()).toContainText('英単語 30分');
  await expect(planDialog.getByRole('button', { name: 'この内容で保存' })).toBeDisabled();
  await planDialog.getByRole('button', { name: '閉じる' }).click();
  await actualCard.getByRole('button', { name: '実績を確認' }).click();
  // With a plan draft present the same preview dialog holds both: a separate study-record section
  // with its own save button next to the (disabled) plan save.
  const combinedDialog = page.getByRole('dialog', { name: '計画プレビュー' });
  const actualDialog = combinedDialog.getByRole('region', { name: '学習実績の確認' });
  await expect(actualDialog.locator('.ai-planning-actual-records-list li')).toHaveCount(6);
  await expect(actualDialog).toContainText('合計 6時間35分');
  await expect(combinedDialog.getByRole('button', { name: 'この内容で保存' })).toBeDisabled();
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  await writes.during('save-actuals', async () => {
    await actualDialog.locator('button.ai-planning-actual-records-save').click();
    await expect(actualDialog).toBeHidden();
    await expect.poll(() => writes.commitsIn('save-actuals').length).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await actualDocuments(request, ownerId)).filter(record => week.includes(record.date)).length).toBe(6);
  });
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 6)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  const saved = (await actualDocuments(request, ownerId)).filter(record => week.includes(record.date));
  const expected = WEEK_RECORDS.map(({ day, subject, minutes }) => ({ date: week[day], subject, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));
  expect(saved.map(({ date, subject, minutes }) => ({ date, subject, minutes }))).toEqual(expected);
  expect(new Set(saved.map(record => record.docId)).size).toBe(6);
  expect(saved.filter(record => record.date === week[3])).toEqual([]);
  expect(saved.reduce((sum, record) => sum + record.minutes, 0)).toBe(WEEK_TOTAL_MINUTES);
  await expect(planCard).toBeVisible();
  await expect.poll(() => activeDraft(page, ownerId, current[0])).toMatchObject({
    id: 'c1-compound-edited-draft', status: 'draft', userEdited: true,
  });
  expect(await activeChatId(page, ownerId)).toBe(migratedChatId);
  await expect(actualCard).toHaveCount(0);
  expect(await ownerEvents(request, ownerId)).toEqual(eventsBefore);
  expect(await page.evaluate(key => localStorage.getItem(key), v5Key)).toBe(v5Raw);

  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await signInAndOpenAi(page);
  await expect(planCard).toBeVisible();
  expect(await activeChatId(page, ownerId)).toBe(migratedChatId);
  await expect.poll(() => activeDraft(page, ownerId, current[0])).toMatchObject({
    id: 'c1-compound-edited-draft', status: 'draft', userEdited: true,
  });
  await planCard.getByRole('button', { name: '計画プレビューを確認' }).click();
  await expect(planDialog.locator('.ai-planning-draft-block').first()).toContainText('英単語 30分');
  await expect(planDialog.getByRole('button', { name: 'この内容で保存' })).toBeDisabled();
  await planDialog.getByRole('button', { name: '閉じる' }).click();
  await expect(actualCard).toHaveCount(0);
  expect((await actualDocuments(request, ownerId)).filter(record => week.includes(record.date))).toEqual(saved);
  expect(await ownerEvents(request, ownerId)).toEqual(eventsBefore);
  const neighbourAfter = await Promise.all(neighbourIds.map(async id => {
    const response = await request.get(`${FIRESTORE}/actuals/${id}`, { headers: OWNER });
    expect(response.ok()).toBe(true);
    return response.json();
  }));
  expect(neighbourAfter).toEqual(neighbourBefore);
  expect(writes.violations()).toEqual([]);
});
