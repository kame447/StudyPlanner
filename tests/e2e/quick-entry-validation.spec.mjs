import { expect, test } from '@playwright/test';

const HARNESS_URL = 'http://127.0.0.1:4174';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function switchToActual(page) {
  const tab = page.getByRole('tab', { name: '記録' });
  if (await tab.count() && await tab.isVisible()) {
    await tab.click();
    return;
  }
  await page.getByRole('button', { name: '記録', exact: true }).click();
}

async function openHarness(page) {
  await page.goto(HARNESS_URL);
  await expect(page.getByRole('button', { name: '保存' })).toBeVisible();
}

async function openScheduledPlan(page, title = '数学演習') {
  await openHarness(page);
  await page.getByRole('button', { name: '時間指定', exact: true }).click();
  await page.getByPlaceholder('例: 英語課題 / 面接準備').fill(title);
}

async function expectSaveBoundaryNotCrossed(page, type) {
  const save = page.getByRole('button', { name: '保存' });
  if (await save.isEnabled()) {
    await save.click();
  }
  expect(await events(page, type)).toHaveLength(0);
}

async function clearSelectedWeekdays(page) {
  for (const label of ['月', '火', '水', '木', '金', '土', '日']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.getAttribute('aria-pressed') === 'true') {
      await button.click();
    }
  }
}

test.describe('quick entry validation browser contracts', () => {
  test('blank or whitespace-only Todo titles never cross the save boundary', async ({ page }) => {
    await openHarness(page);

    const title = page.getByPlaceholder('例: 英語課題 / 面接準備');
    await title.fill('   ');
    await expectSaveBoundaryNotCrossed(page, 'save-todo');

    await title.fill('英語課題');
    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await events(page, 'save-todo')).length).toBe(1);
  });

  test('scheduled plans do not cross the save boundary until an end-defining duration is provided', async ({ page }) => {
    await openScheduledPlan(page);
    await page.getByLabel('日付').fill('2026-08-14');
    await page.getByLabel('開始時刻').fill('18:30');

    await expectSaveBoundaryNotCrossed(page, 'save-plan');

    await page.getByRole('button', { name: '60分', exact: true }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);
  });

  test('scheduled plans cannot cross the save boundary without a date', async ({ page }) => {
    await openScheduledPlan(page);
    await page.getByRole('button', { name: '60分', exact: true }).click();
    await page.getByLabel('日付').fill('');

    await expectSaveBoundaryNotCrossed(page, 'save-plan');
  });

  test('scheduled plans cannot cross the save boundary without a start time', async ({ page }) => {
    await openScheduledPlan(page);
    await page.getByRole('button', { name: '60分', exact: true }).click();
    await page.getByLabel('開始時刻').fill('');

    await expectSaveBoundaryNotCrossed(page, 'save-plan');
  });

  test('scheduled plans preserve their requested duration across midnight', async ({ page }) => {
    await openScheduledPlan(page, '夜の復習');
    await page.getByLabel('日付').fill('2026-08-14');
    await page.getByLabel('開始時刻').fill('23:30');
    await page.getByRole('button', { name: '60分', exact: true }).click();
    await page.getByRole('button', { name: '保存' }).click();

    await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);
    expect((await events(page, 'save-plan'))[0].payload).toMatchObject({
      date: '2026-08-14',
      startTime: '23:30',
      endTime: '00:30',
      repeat: 'none',
    });
  });

  test('custom scheduled duration accepts the representable 1439-minute maximum', async ({ page }) => {
    await openScheduledPlan(page, '長時間学習');
    await page.getByRole('button', { name: '自由', exact: true }).click();
    await page.getByLabel('自由入力（分）').fill('1439');
    await page.getByRole('button', { name: '保存' }).click();

    await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);
    expect((await events(page, 'save-plan'))[0].payload).toMatchObject({
      startTime: '19:00',
      endTime: '18:59',
    });
  });

  test('custom scheduled duration rejects 1440 minutes because the plan model cannot represent a full-day duration', async ({ page }) => {
    await openScheduledPlan(page, '長時間学習');
    await page.getByRole('button', { name: '自由', exact: true }).click();
    await page.getByLabel('自由入力（分）').fill('1440');

    await expectSaveBoundaryNotCrossed(page, 'save-plan');
  });

  test('custom duration rejects missing or non-positive values before accepting a positive duration', async ({ page }) => {
    await openScheduledPlan(page);
    await page.getByRole('button', { name: '自由', exact: true }).click();

    const custom = page.getByLabel('自由入力（分）');
    await expectSaveBoundaryNotCrossed(page, 'save-plan');

    await custom.fill('0');
    await expectSaveBoundaryNotCrossed(page, 'save-plan');

    await custom.fill('75');
    await page.getByRole('button', { name: '保存' }).click();

    await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);
    expect((await events(page, 'save-plan'))[0].payload).toMatchObject({
      startTime: '19:00',
      endTime: '20:15',
    });
  });

  test('weekly recurrence cannot cross the save boundary with no selected weekdays', async ({ page }) => {
    await openHarness(page);

    await page.getByRole('button', { name: '繰り返し', exact: true }).click();
    await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英単語');
    await page.getByRole('button', { name: '60分', exact: true }).click();
    await page.getByRole('button', { name: '毎週', exact: true }).click();

    await clearSelectedWeekdays(page);
    await expectSaveBoundaryNotCrossed(page, 'save-plan');

    await page.getByRole('button', { name: '月', exact: true }).click();
    await page.getByRole('button', { name: '保存' }).click();

    await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);
    expect((await events(page, 'save-plan'))[0].payload.repeat).toBe('weekly');
  });

  for (const recurrence of [
    { button: '毎日', expectedRepeat: 'daily' },
    { button: '毎月', expectedRepeat: 'monthly' },
  ]) {
    test(`${recurrence.button} recurrence reaches the save boundary as the selected recurrence`, async ({ page }) => {
      await openHarness(page);

      await page.getByRole('button', { name: '繰り返し', exact: true }).click();
      await page.getByPlaceholder('例: 英語課題 / 面接準備').fill('英語長文');
      await page.getByLabel('開始日').fill('2026-08-15');
      await page.getByLabel('開始時刻').fill('07:30');
      await page.getByRole('button', { name: '30分', exact: true }).click();
      await page.getByRole('button', { name: recurrence.button, exact: true }).click();
      await page.getByRole('button', { name: '保存' }).click();

      await expect.poll(async () => (await events(page, 'save-plan')).length).toBe(1);
      expect((await events(page, 'save-plan'))[0].payload).toMatchObject({
        date: '2026-08-15',
        startTime: '07:30',
        endTime: '08:00',
        repeat: recurrence.expectedRepeat,
      });
    });
  }

  test('actual records preserve a sub-day duration across midnight', async ({ page }) => {
    await openHarness(page);

    await switchToActual(page);
    await page.getByPlaceholder('例: 英語の復習').fill('夜の学習');
    await page.getByLabel('開始時刻').fill('23:30');
    await page.getByRole('button', { name: '60分', exact: true }).click();
    await page.getByRole('button', { name: '保存' }).click();

    await expect.poll(async () => (await events(page, 'save-actual')).length).toBe(1);
    expect((await events(page, 'save-actual'))[0].payload).toMatchObject({
      occurrenceDate: '2026-08-13',
      actualStartTime: '23:30',
      actualEndTime: '00:30',
    });
  });

  test('actual records reject a 1440-minute duration that cannot be represented by start and end clock times', async ({ page }) => {
    await openHarness(page);
    await switchToActual(page);
    await page.getByPlaceholder('例: 英語の復習').fill('長時間学習');
    await page.getByRole('button', { name: '自由', exact: true }).click();
    await page.getByLabel('自由入力（分）').fill('1440');

    await expectSaveBoundaryNotCrossed(page, 'save-actual');
  });
});
