import { expect, test } from '@playwright/test';

const HARNESS_URL = 'http://127.0.0.1:4174';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function switchInputKind(page, name) {
  const tab = page.getByRole('tab', { name });
  if (await tab.count()) {
    await tab.click();
    return;
  }
  await page.getByRole('button', { name, exact: true }).click();
}

async function openManualHarness(page) {
  await page.goto(HARNESS_URL);
  await expect(page.getByPlaceholder('例: 英語課題 / 面接準備')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存' })).toBeVisible();
}

test.describe('manual quick entry browser flows', () => {
  test('Todo deadline and pin state are delivered to the save boundary', async ({ page }) => {
    await openManualHarness(page);

    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英語課題');
    await page.getByLabel('締切日').fill('2026-08-20');
    await page.getByLabel('締切時刻').fill('23:00');
    await page.getByRole('button', { name: 'ピン留め' }).click();

    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await events(page, 'save-todo')).length).toBe(1);

    expect((await events(page, 'save-todo'))[0].payload).toMatchObject({
      userId: 'browser-test-user',
      title: '英語課題',
      dueDate: '2026-08-20',
      dueTime: '23:00',
      pinned: true,
    });
  });

  test('clearing the Todo deadline does not leave an orphan deadline time at the save boundary', async ({ page }) => {
    await openManualHarness(page);

    await page.getByLabel('締切日').fill('2026-08-20');
    await page.getByLabel('締切時刻').fill('23:00');
    await page.getByLabel('締切日').fill('');

    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英語課題');
    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await events(page, 'save-todo')).length).toBe(1);
    expect((await events(page, 'save-todo'))[0].payload.dueTime ?? '').toBe('');
  });

  test('scheduled plan derives the end time from the selected duration', async ({ page }) => {
    await openManualHarness(page);

    await page.getByRole('button', { name: '時間指定', exact: true }).click();
    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('数学演習');
    await page.getByLabel('日付').fill('2026-08-14');
    await page.getByLabel('開始時刻').fill('18:30');
    await page.getByRole('button', { name: '60分', exact: true }).click();

    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);

    expect((await events(page, 'save-plan'))[0].payload).toMatchObject({
      userId: 'browser-test-user',
      title: '数学演習',
      date: '2026-08-14',
      startTime: '18:30',
      endTime: '19:30',
    });
  });

  test('actual record derives its end time and uses the selected occurrence date', async ({ page }) => {
    await openManualHarness(page);

    await switchInputKind(page, '記録');
    await page.getByPlaceholder('例: 英語の復習').fill('英語の復習');
    await page.getByLabel('開始時刻').fill('19:00');
    await page.getByRole('button', { name: '45分', exact: true }).click();

    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await events(page, 'save-actual')).length).toBe(1);

    expect((await events(page, 'save-actual'))[0].payload).toMatchObject({
      userId: 'browser-test-user',
      occurrenceDate: '2026-08-13',
      actualStartTime: '19:00',
      actualEndTime: '19:45',
      title: '英語の復習',
      isAlignedToPlan: false,
    });
  });

  test('switching between AI input, actual records, and plans never leaves the plan surface without a usable input mode', async ({ page }) => {
    await openManualHarness(page);

    await page.getByRole('button', { name: 'AI入力', exact: true }).click();
    await expect(page.getByText('AI入力補助')).toBeVisible();

    await switchInputKind(page, '記録');
    await expect(page.getByPlaceholder('例: 英語の復習')).toBeVisible();

    await switchInputKind(page, '予定');
    const manualInput = page.getByPlaceholder('例: 英語課題 / 面接準備');
    const aiSurface = page.getByText('AI入力補助');
    const manualVisible = await manualInput.isVisible().catch(() => false);
    const aiVisible = await aiSurface.isVisible().catch(() => false);
    expect(manualVisible || aiVisible).toBe(true);
  });
});
