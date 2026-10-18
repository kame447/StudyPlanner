import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html?preview=1';
const EXPECTED_DRAFT = {
  id: 'real-app-preview-math',
  title: '数学のワーク',
  date: '2026-08-18',
  startTime: '19:00',
  endTime: '20:00',
  status: 'draft',
};

async function events(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function planningState(page) {
  return page.evaluate(() => window.__realWeeklyState);
}

function previewDialog(page) {
  return page.getByRole('dialog', { name: '計画プレビュー' });
}

async function expectNoApprovalOrSave(page) {
  expect((await planningState(page)).pendingApproval).toBeUndefined();
  expect(await events(page, 'real-save-approved-plan')).toHaveLength(0);
  expect(await events(page, 'real-complete-approved-plan')).toHaveLength(0);
}

async function expectOneDraft(page) {
  await expect.poll(async () => (await planningState(page)).draftBlocks.length).toBe(1);
  const state = await planningState(page);
  expect(state.draftBlocks[0]).toMatchObject(EXPECTED_DRAFT);
  expect(state.previewCandidates).toEqual([]);
  expect(state.mode).toBe('awaiting_approval');
  await expect(previewDialog(page).getByRole('button', { name: 'この内容で保存', exact: true })).toBeVisible();
  await expectNoApprovalOrSave(page);
}

async function removeExactBlock(page) {
  const block = previewDialog(page).locator(`[data-ai-preview-action-block="${EXPECTED_DRAFT.id}"]`);
  await expect(block).toHaveCount(1);
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error('Preview block is not measurable');
  const remove = page.getByRole('button', { name: `${EXPECTED_DRAFT.title}を計画から除外`, exact: true });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(remove).toBeVisible();
  await page.mouse.up();
  await remove.click();
}

test.describe('production weekly preview and draft boundaries', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const input = page.locator('.ai-planning-composer textarea');
    await expect(input).toBeVisible();
    await input.fill('仮予定と承認の境界を検査する条件');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '計画プレビューを確認' }).click();
    await expect(previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect.poll(async () => (await planningState(page)).previewCandidates?.map((candidate) => candidate.stableKey))
      .toEqual([EXPECTED_DRAFT.id]);
    expect((await planningState(page)).draftBlocks).toEqual([]);
    await expectNoApprovalOrSave(page);
  });

  test('preview can be inspected and removed without promoting or approving it', async ({ page }) => {
    const revision = (await planningState(page)).revision;
    await removeExactBlock(page);

    await expect.poll(async () => (await planningState(page)).previewCandidates).toEqual([]);
    expect((await planningState(page)).revision).toBe(revision + 1);
    expect((await planningState(page)).draftBlocks).toEqual([]);
    await expect(previewDialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
    await expectNoApprovalOrSave(page);
  });

  test('preview promotion preserves the user-visible task and schedule at the draft boundary', async ({ page }) => {
    const revision = (await planningState(page)).revision;
    await previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' }).click();
    await expectOneDraft(page);
    // One accepted mutation: a create/clear/recreate promotion would end in the
    // same visible state but advance the revision more than once.
    expect((await planningState(page)).revision).toBe(revision + 1);
  });

  test('a draft can be removed locally without invoking approval', async ({ page }) => {
    const promotedFrom = (await planningState(page)).revision;
    await previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' }).click();
    await expectOneDraft(page);
    const revision = (await planningState(page)).revision;
    expect(revision).toBe(promotedFrom + 1);
    await removeExactBlock(page);

    await expect.poll(async () => (await planningState(page)).draftBlocks).toEqual([]);
    expect((await planningState(page)).revision).toBe(revision + 1);
    expect((await planningState(page)).previewCandidates).toEqual([]);
    await expect(previewDialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
    await expectNoApprovalOrSave(page);
  });
});

// The production preview still creates two drafts when promotion fires twice in
// one browser task, and a real double-click saves before review (#751). Until
// that is fixed and its production case lands, keep this legacy-harness check.
const LEGACY_HARNESS_PREVIEW_URL = 'http://127.0.0.1:4174/?scenario=preview';

async function legacyHarnessEvents(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

test.describe('legacy weekly preview harness (pending #751)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(LEGACY_HARNESS_PREVIEW_URL);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  });

  test('two promotion activations in the same browser task create one draft batch', async ({ page }) => {
    const promote = page.getByRole('button', { name: 'この内容で仮予定にする' });
    await promote.evaluate((button) => {
      button.click();
      button.click();
    });

    expect(await legacyHarnessEvents(page, 'create-weekly-draft-blocks')).toHaveLength(1);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
  });
});
