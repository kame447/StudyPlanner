import { expect, test } from '@playwright/test';

const HARNESS_BASE = 'http://127.0.0.1:4174';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

test.describe('QuickEntryModal weekly local preview controls', () => {
  test('closing a local preview removes it without promoting or approving it', async ({ page }) => {
    await page.goto(`${HARNESS_BASE}/?scenario=preview`);
    const promote = page.getByRole('button', { name: 'この内容で仮予定にする' });
    await expect(promote).toBeVisible();

    await page.getByRole('button', { name: 'previewを閉じる' }).click();

    await expect(promote).toHaveCount(0);
    expect(await events(page, 'create-weekly-draft-blocks')).toHaveLength(0);
    expect(await events(page, 'approve-drafts')).toHaveLength(0);
  });

  test('bulk discard removes draft approval UI without invoking approval', async ({ page }) => {
    await page.goto(`${HARNESS_BASE}/?scenario=draft`);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();

    await page.getByRole('button', { name: '一括破棄' }).click();

    await expect(page.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
    expect(await events(page, 'approve-drafts')).toHaveLength(0);
  });
});
