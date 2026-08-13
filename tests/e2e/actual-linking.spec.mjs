import { expect, test } from '@playwright/test';

const HARNESS_BASE = 'http://127.0.0.1:4174';

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

async function switchToActual(page) {
  const tab = page.getByRole('tab', { name: '記録' });
  if (await tab.count() && await tab.isVisible()) {
    await tab.click();
    return;
  }
  await page.getByRole('button', { name: '記録', exact: true }).click();
}

async function fillMatchingActual(page, scenario, gate = '') {
  const gateQuery = gate ? `&gate=${encodeURIComponent(gate)}` : '';
  await page.goto(`${HARNESS_BASE}/?scenario=${scenario}${gateQuery}`);
  await switchToActual(page);
  await page.getByPlaceholder('例: 英語の復習').fill('英語の復習');
  await page.getByLabel('科目').fill('英語');
  await page.getByLabel('開始時刻').fill('19:00');
  await page.getByRole('button', { name: '45分', exact: true }).click();
}

test.describe('actual-to-plan linking browser contracts', () => {
  test('a strong matching plan can be selected and saved through the linked-actual boundary', async ({ page }) => {
    await fillMatchingActual(page, 'linked-actual');

    await expect(page.getByText('近い予定候補')).toBeVisible();
    await expect(page.getByText(/19:00-19:45 英語の復習/)).toBeVisible();

    await page.getByRole('button', { name: 'この予定に紐づけて保存' }).click();
    await expect.poll(async () => (await events(page, 'save-linked-actual')).length).toBe(1);

    const { plan, draft } = (await events(page, 'save-linked-actual'))[0].payload;
    expect(plan.id).toBe('browser-plan-english');
    expect(draft).toMatchObject({
      planId: 'browser-plan-english',
      occurrenceDate: '2026-08-13',
      actualStartTime: '19:00',
      actualEndTime: '19:45',
      title: '英語の復習',
      subject: '英語',
    });
    expect(await events(page, 'save-actual')).toHaveLength(0);
  });

  test('a pending linked save leaves no actionable second linked-save path', async ({ page }) => {
    await fillMatchingActual(page, 'linked-actual', 'save-linked-actual');

    const linkButton = page.getByRole('button', { name: 'この予定に紐づけて保存' });
    await linkButton.click({ noWaitAfter: true });
    await expect.poll(async () => (await events(page, 'save-linked-actual')).length).toBe(1);

    await expectNotActionable(linkButton);
    expect(await events(page, 'save-linked-actual')).toHaveLength(1);

    await release(page, 'save-linked-actual');
    await expect.poll(async () => (await events(page, 'complete-save-linked-actual')).length).toBe(1);
  });

  test('two linked-save activations in the same browser task cross the save boundary once', async ({ page }) => {
    await fillMatchingActual(page, 'linked-actual', 'save-linked-actual');

    const linkButton = page.getByRole('button', { name: 'この予定に紐づけて保存' });
    await linkButton.evaluate((button) => {
      button.click();
      button.click();
    });

    await expect.poll(async () => (await events(page, 'save-linked-actual')).length).toBeGreaterThanOrEqual(1);
    expect(await events(page, 'save-linked-actual')).toHaveLength(1);

    await release(page, 'save-linked-actual');
    await expect.poll(async () => (await events(page, 'complete-save-linked-actual')).length).toBe(1);
  });

  test('closing while linked save is pending keeps the modal closed and does not duplicate the save', async ({ page }) => {
    await fillMatchingActual(page, 'linked-actual', 'save-linked-actual');

    await page.getByRole('button', { name: 'この予定に紐づけて保存' }).click({ noWaitAfter: true });
    await expect.poll(async () => (await events(page, 'save-linked-actual')).length).toBe(1);

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();

    await release(page, 'save-linked-actual');
    await expect.poll(async () => (await events(page, 'complete-save-linked-actual')).length).toBe(1);

    await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();
    expect(await events(page, 'save-linked-actual')).toHaveLength(1);
  });

  test('an already recorded plan occurrence offers no actionable second link save', async ({ page }) => {
    await fillMatchingActual(page, 'recorded-actual');

    await expect(page.getByText('記録済み')).toBeVisible();
    await expectNotActionable(page.getByRole('button', { name: 'この予定に紐づけて保存' }));
    expect(await events(page, 'save-linked-actual')).toHaveLength(0);
  });
});
