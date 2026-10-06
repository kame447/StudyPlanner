import { expect, test } from '@playwright/test';

const HARNESS_URL = 'http://127.0.0.1:4174';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function release(page, type) {
  const released = await page.evaluate((gateType) => window.__quickEntryHarness.release(gateType), type);
  expect(released).toBe(true);
}

async function expectNotActionable(locator) {
  if ((await locator.count()) === 0) return;
  if (!(await locator.isVisible())) return;
  await expect(locator).toBeDisabled();
}

async function openHarness(page, query = '') {
  await page.goto(`${HARNESS_URL}${query}`);
  await expect(page.getByRole('button', { name: '閉じる' })).toBeVisible();
}

test.describe('quick entry modal browser lifecycle', () => {
  test('clicking inside the modal does not close the modal', async ({ page }) => {
    await openHarness(page);

    const title = page.getByPlaceholder('例: 英語課題 / 面接準備');
    await title.click();
    await title.fill('英語課題');

    await expect(page.getByRole('button', { name: '閉じる' })).toBeVisible();
    expect(await events(page, 'close')).toHaveLength(0);
  });

  test('closing a pending save cannot dismiss a newly opened draft', async ({ page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await openHarness(page, '?gate=save-todo');
      await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('前の保存');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect.poll(async () => (await events(page, 'save-todo')).length).toBe(1);
      await page.getByRole('button', { name: '閉じる' }).click();
      await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();
      await page.getByRole('button', { name: 'モーダルを再度開く' }).click();
      const draft = page.getByPlaceholder('例: 英語課題 / 面接準備');
      await draft.fill('新しい未保存の入力');
      await release(page, 'save-todo');
      await expect.poll(async () => (await events(page, 'complete-save-todo')).length).toBe(1);
      await expect(draft).toHaveValue('新しい未保存の入力');
      expect(await events(page, 'close')).toHaveLength(1);
    }
  });

  test('a pending Todo save leaves no actionable second save path and persists once', async ({ page }) => {
    await openHarness(page, '/?gate=save-todo');

    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英語課題');
    const saveButton = page.getByRole('button', { name: '保存' });
    await saveButton.click({ noWaitAfter: true });

    await expect.poll(async () => (await events(page, 'save-todo')).length).toBe(1);
    await expectNotActionable(saveButton);
    expect(await events(page, 'save-todo')).toHaveLength(1);

    await release(page, 'save-todo');
    await expect.poll(async () => (await events(page, 'complete-save-todo')).length).toBe(1);
    expect(await events(page, 'save-todo')).toHaveLength(1);
  });

  test('two Todo save activations in the same browser task cross the save boundary once', async ({ page }) => {
    await openHarness(page, '/?gate=save-todo');

    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英語課題');
    const saveButton = page.getByRole('button', { name: '保存' });
    await saveButton.evaluate((button) => {
      button.click();
      button.click();
    });

    await expect.poll(async () => (await events(page, 'save-todo')).length).toBeGreaterThanOrEqual(1);
    expect(await events(page, 'save-todo')).toHaveLength(1);

    await release(page, 'save-todo');
    await expect.poll(async () => (await events(page, 'complete-save-todo')).length).toBe(1);
  });

  test('closing while a save is pending does not reopen the modal or duplicate the save when it resolves', async ({ page }) => {
    await openHarness(page, '/?gate=save-todo');

    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英語課題');
    await page.getByRole('button', { name: '保存' }).click({ noWaitAfter: true });

    await expect.poll(async () => (await events(page, 'save-todo')).length).toBe(1);
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();

    await release(page, 'save-todo');
    await expect.poll(async () => (await events(page, 'complete-save-todo')).length).toBe(1);

    await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();
    expect(await events(page, 'save-todo')).toHaveLength(1);
  });
});
