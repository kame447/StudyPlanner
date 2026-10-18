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

  test('two promotion activations in the same browser task create one draft batch', async ({ page }) => {
    const revision = (await planningState(page)).revision;
    await previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expectOneDraft(page);
    expect((await planningState(page)).revision).toBe(revision + 1);
  });

  test('a real double-click promotes once and requires a later explicit Save', async ({ page }) => {
    const revision = (await planningState(page)).revision;
    const promote = previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' });
    const promotionElement = await promote.elementHandle();
    const promotionBox = await promote.boundingBox();
    await promote.dblclick();
    await expectOneDraft(page);
    expect((await planningState(page)).revision).toBe(revision + 1);

    // The original pointer/focus target stays inert; approval has its own
    // element and occupies a different row even when the input is very fast.
    expect(await promotionElement.evaluate(button => button.isConnected && button.disabled)).toBe(true);
    const save = previewDialog(page).getByRole('button', { name: 'この内容で保存', exact: true });
    const saveBox = await save.boundingBox();
    if (!promotionBox || !saveBox) throw new Error('Preview actions are not measurable');
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(promotionBox.y);

    await save.click();
    await expect.poll(async () => (await events(page, 'real-complete-approved-plan')).length).toBe(1);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    expect((await planningState(page)).draftBlocks).toEqual([]);
    await expect(previewDialog(page)).toHaveCount(0);
  });

  test('repeated and held keyboard activation promotes once and keeps focus off Save', async ({ page }) => {
    const revision = (await planningState(page)).revision;
    const promote = previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' });
    await promote.focus();
    for (let press = 0; press < 3; press += 1) await page.keyboard.press('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expectOneDraft(page);
    expect((await planningState(page)).revision).toBe(revision + 1);
    // Focus stays in the dialog on an inert target, never on Save.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('dialog');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expectOneDraft(page);
  });

  test('two taps at the promotion position keep approval pending', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Touch contract runs in the WebKit mobile project');
    const revision = (await planningState(page)).revision;
    const promote = previewDialog(page).getByRole('button', { name: 'この内容で仮予定にする' });
    // The dialog footer can sit below the mobile fold; raw coordinates only hit it once scrolled.
    await promote.scrollIntoViewIfNeeded();
    const box = await promote.boundingBox();
    if (!box) throw new Error('Promotion control is not measurable');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expectOneDraft(page);
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
