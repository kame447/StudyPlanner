import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';
import { seedHomeAdd } from './support/home-add-fixture.mjs';

async function savedEntries(page, kind) {
  return page.evaluate(kind => JSON.parse(localStorage.getItem(kind === 'plan'
    ? 'studyplanner.scheduleEvents.v1' : 'studyplanner.actuals') ?? '[]'), kind);
}

for (const width of [390, 1280]) for (const kind of ['plan', 'actual']) {
  test(`overnight ${kind} survives real save, reload and next-day display at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await seedHomeAdd(page);
    await page.goto('/');
    await page.getByRole('button', { name: '今日の予定に追加', exact: true }).click();
    await page.getByRole('button', { name: '学習予定を追加', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '予定・記録の追加' });
    if (kind === 'actual') await editor.getByRole('tab', { name: '記録', exact: true }).click();
    const title = kind === 'plan' ? '日をまたぐ学習予定' : '日をまたぐ学習記録';
    await editor.getByPlaceholder(kind === 'plan' ? '例: 英語課題 / 面接準備' : '例: 英語の復習').fill(title);
    await editor.getByLabel('日付', { exact: true }).fill(E2E_TODAY);
    await editor.getByLabel('開始時刻', { exact: true }).fill('23:30');
    await editor.getByRole('button', { name: '60分', exact: true }).click();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await savedEntries(page, kind)).length).toBe(1);
    const expected = kind === 'plan' ? { date: E2E_TODAY, startTime: '23:30', endTime: '00:30' }
      : { occurrenceDate: E2E_TODAY, actualStartTime: '23:30', actualEndTime: '00:30' };
    const saved = (await savedEntries(page, kind))[0];
    expect(saved).toMatchObject({ ...expected, title });
    await page.reload();
    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
    await page.getByRole('tab', { name: '日', exact: true }).click();
    const row = () => kind === 'actual'
      ? page.locator('.timeline-actual-block').filter({ hasText: title })
      : page.getByRole('button', { name: `${title}。終日または日を跨ぐ予定。長押しで操作`, exact: true });
    await expect(row()).toHaveCount(1);
    if (kind === 'actual') await expect(row()).toHaveAttribute('aria-label', /23:30から24:00/);
    await page.getByRole('button', { name: '翌日', exact: true }).click();
    await expect(row()).toHaveCount(1);
    if (kind === 'actual') {
      await expect(row()).toHaveAttribute('aria-label', /00:00から00:30/);
      await row().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`overnight-${kind}-${width}-tail.png`) });
      await row().click();
      const actualEditor = page.locator('.standalone-actual-editor-card');
      await expect(actualEditor.getByLabel('日付', { exact: true })).toHaveValue(E2E_TODAY);
      await actualEditor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(actualEditor).toHaveCount(0);
      await expect.poll(async () => (await savedEntries(page, kind))[0]).toMatchObject({ id: saved.id, ...expected });
    } else await page.screenshot({ path: testInfo.outputPath(`overnight-${kind}-${width}-tail.png`) });
    expect(await savedEntries(page, kind)).toHaveLength(1);
    expect((await savedEntries(page, kind))[0]).toMatchObject({ id: saved.id, ...expected });
    expect(errors).toEqual([]);
  });
}
