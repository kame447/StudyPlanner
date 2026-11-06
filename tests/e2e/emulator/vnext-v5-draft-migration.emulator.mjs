import { E2E_FIXED_NOW, expect, test } from '../support/fixed-clock.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5.ts';
import { createInitialPlanningState } from '../../../src/features/weeklyPlanning/weeklyPlanningReducer.ts';
import { largestWeeklyPlanningStableV5Checkpoint, prepareWeeklyPlanningStableV5Checkpoint,
  weeklyPlanningStableV5StorageKey } from '../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5SessionCodec.ts';

const WEEK = '2026-08-17';
const DATE = '2026-08-20';
const NOW = '2026-08-19T01:00:00.000Z';
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

function editedV5Checkpoint(ownerId) {
  const conversationId = 'c1-browser-v5-conversation';
  const block = {
    id: 'c1-edited-draft', userId: ownerId, date: DATE, startTime: '10:00', endTime: '10:30',
    title: '英単語 30分', subject: '英単語', type: 'study', label: '英単語', memo: '利用者が変更した未保存の仮予定',
    source: 'ai', status: 'draft', userEdited: true, createdAt: NOW, updatedAt: NOW,
    behaviorMetadata: {
      conversationId, stateRevision: 0, sourceFactRefs: [], usedAssumptionProposalRefs: [],
      taskRef: 'v5-task', opportunityTags: [], reasoningKey: 'stable-v5-explicit-duration',
      compatibility: { workItemSemantic: 'generic_semantic_task', schedulerInputSource: 'stable_v5_generic_scheduler_input', candidateSource: 'stable_v5' },
      previewMetadata: { previewId: 'stable-v5-preview', conversationId, stateRevision: 0,
        assumptionDependencies: [], approvalEligibility: 'eligible', stale: false, authorizedUserId: ownerId },
    },
  };
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const planningState = { ...createInitialPlanningState(WEEK), mode: 'awaiting_approval',
    draftBlocks: [block], previewCandidates: [], messages: [{
      id: 'c1-message', role: 'user', content: '英単語を30分進めたい', createdAt: NOW,
    }] };
  const prepared = prepareWeeklyPlanningStableV5Checkpoint({ ownerId, weekStartDate: WEEK, conversationId, graph, planningState });
  expect(prepared.status).toBe('ready');
  const written = largestWeeklyPlanningStableV5Checkpoint({ ownerId, weekStartDate: WEEK, conversationId,
    graph, planningState: prepared.planningState, savedAt: NOW });
  expect(written).not.toBeNull();
  return written.raw;
}

async function openWithV5Source(page, key, raw) {
  await page.goto('/');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(signInTab).toBeVisible();
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
  await signInTab.click();
  await page.getByLabel('メールアドレス').fill(email());
  await page.getByLabel('パスワード', { exact: true }).fill(password());
  await page.getByRole('button', { name: 'ログインする' }).click();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
}

async function ownerEvents(request, ownerId) {
  const response = await request.get(`${FIRESTORE}/schedule_events?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok()).toBe(true);
  return ((await response.json()).documents ?? []).filter(document => document.fields?.userId?.stringValue === ownerId);
}

async function activeDraft(page, ownerId) {
  return page.evaluate(({ ownerId, week }) => {
    const index = JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${ownerId}`) ?? 'null');
    if (!index?.activeChatId) return null;
    const raw = localStorage.getItem(`studyplanner.weeklyPlanning.vnext.${ownerId}.${week}.${index.activeChatId}.ui`);
    return raw ? JSON.parse(raw).payload?.state?.draftBlocks?.[0] ?? null : null;
  }, { ownerId, week: WEEK });
}

async function dragBy(locator, page, deltaY) {
  await locator.hover({ trial: true });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 5 });
  await page.mouse.up();
}

test('C1 migration: an edited V5 draft stays visible and editable without regaining approval', async ({ page, browser, request }) => {
  const cleanStorage = await page.context().storageState();
  const ownerId = await emulatorUserId(request, { email: email(), password: password() });
  const key = weeklyPlanningStableV5StorageKey(ownerId, WEEK);
  const raw = editedV5Checkpoint(ownerId);
  const writes = attachWriteLedger(page);
  const eventsBefore = await ownerEvents(request, ownerId);

  await openWithV5Source(page, key, raw);
  await expect(page.locator('.ai-planning-plan-card')).toContainText('1件');
  await expect.poll(() => activeDraft(page, ownerId)).toMatchObject({
    id: 'c1-edited-draft', memo: '利用者が変更した未保存の仮予定', userEdited: true,
  });
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  const draft = preview.locator('.ai-planning-draft-block').first();
  await expect(draft).toContainText('英単語 30分');
  await expect(draft).toContainText('10:00-10:30');
  await expect(preview.getByRole('button', { name: 'この内容で保存' })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  expect(await ownerEvents(request, ownerId)).toEqual(eventsBefore);

  await page.reload();
  await page.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-plan-card')).toContainText('1件');
  await expect.poll(() => activeDraft(page, ownerId)).toMatchObject({
    id: 'c1-edited-draft', memo: '利用者が変更した未保存の仮予定', userEdited: true,
  });
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const reopened = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(reopened.locator('.ai-planning-draft-block').first()).toContainText('10:00-10:30');
  await expect(reopened.getByRole('button', { name: 'この内容で保存' })).toBeDisabled();
  await reopened.getByRole('tab', { name: '日別' }).click();
  const editable = reopened.locator('.ai-planning-preview-day-column-detail .ai-planning-draft-block');
  await expect(editable).toHaveCount(1);
  await dragBy(editable, page, 38);
  await expect(editable.locator('small')).toHaveText('11:00-11:30');
  await expect(reopened.getByRole('button', { name: 'この内容で保存' })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  expect(await ownerEvents(request, ownerId)).toEqual(eventsBefore);
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  // A fresh browser context avoids reusing the successfully migrated VNext chat for the two rejection cases.
  for (const rejectedRaw of [editedV5Checkpoint('different-owner'), '{invalid-json']) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4176', storageState: cleanStorage,
      timezoneId: 'Asia/Tokyo' });
    try {
      await context.clock.install({ time: E2E_FIXED_NOW });
      const isolated = await context.newPage();
      await openWithV5Source(isolated, key, rejectedRaw);
      await expect(isolated.locator('.ai-planning-plan-card')).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
