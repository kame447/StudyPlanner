import { expect, test } from '@playwright/test';

const HARNESS_BASE = 'http://127.0.0.1:4174';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

function previewDateButton(page) {
  return page.getByRole('button', { name: /8\/18/ }).first();
}

test.describe('weekly preview QuickEntryModal UI contracts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${HARNESS_BASE}/?scenario=preview`);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  });

  test('preview can be inspected and removed without promoting or approving it', async ({ page }) => {
    await previewDateButton(page).click();
    await page.getByRole('button', { name: '数学のワークを削除' }).click();

    expect(await events(page, 'remove-preview')).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toHaveCount(0);
    expect(await events(page, 'create-weekly-draft-blocks')).toHaveLength(0);
    expect(await events(page, 'approve-drafts')).toHaveLength(0);
  });

  test('preview promotion preserves the user-visible task and schedule at the draft boundary', async ({ page }) => {
    await page.getByRole('button', { name: 'この内容で仮予定にする' }).click();

    expect(await events(page, 'create-weekly-draft-blocks')).toHaveLength(1);
    const promoted = (await events(page, 'create-weekly-draft-blocks'))[0].payload;
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toMatchObject({
      title: '数学のワーク',
      date: '2026-08-18',
      startTime: '19:00',
      endTime: '20:00',
    });

    await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
  });

  test('two promotion activations in the same browser task create one draft batch', async ({ page }) => {
    const promote = page.getByRole('button', { name: 'この内容で仮予定にする' });
    await promote.evaluate((button) => {
      button.click();
      button.click();
    });

    expect(await events(page, 'create-weekly-draft-blocks')).toHaveLength(1);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
  });
});

test.describe('weekly draft QuickEntryModal UI contracts', () => {
  test('a draft can be removed locally without invoking approval', async ({ page }) => {
    await page.goto(`${HARNESS_BASE}/?scenario=draft`);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();

    await previewDateButton(page).click();
    await page.getByRole('button', { name: '数学のワークを削除' }).click();

    expect(await events(page, 'remove-draft')).toHaveLength(1);
    expect(await events(page, 'approve-drafts')).toHaveLength(0);
  });
});
