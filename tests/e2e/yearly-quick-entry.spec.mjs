import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';
import { seedHomeAdd } from './support/home-add-fixture.mjs';

async function savedEvents(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
}

for (const width of [390, 1280]) {
  test(`yearly entry keeps its type order and survives reload into the next year at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await seedHomeAdd(page);
    await page.goto('/');
    await page.getByRole('button', { name: '今日の予定に追加', exact: true }).click();
    await page.getByRole('button', { name: '学習予定を追加', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '予定・記録の追加' });
    const tabs = editor.locator('.quick-entry-mode-tabs button');
    await expect(tabs).toHaveText(['時間指定', 'Todo', '繰り返し']);
    await expect(tabs.filter({ hasText: '時間指定' })).toHaveClass(/active/);
    await editor.getByRole('button', { name: '繰り返し', exact: true }).click();
    await editor.getByPlaceholder('例: 英語課題 / 面接準備').fill('年に一度の予定');
    await editor.getByRole('combobox', { name: '種別', exact: true }).selectOption('other');
    await editor.getByRole('button', { name: '毎年', exact: true }).click();
    // A prior-year anchor lets the real app demonstrate next-year expansion on
    // today's calendar without replacing storage or the app's selected date.
    await editor.getByLabel('開始日', { exact: true }).fill('2025-08-19');
    await editor.getByLabel('開始時刻', { exact: true }).fill('19:00');
    await editor.getByRole('button', { name: '30分', exact: true }).click();
    await editor.getByRole('button', { name: '毎年', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`yearly-editor-${width}.png`), animations: 'disabled' });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await savedEvents(page)).length).toBe(1);
    const saved = (await savedEvents(page))[0];
    expect(saved).toMatchObject({ date: '2025-08-19', title: '年に一度の予定',
      recurrence: { repeat: 'yearly', rules: [{ kind: 'yearly', startDate: '2025-08-19' }] } });
    await page.reload();
    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
    const cell = page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]');
    const monthEvent = cell.locator('.month-major-event-pill').filter({ hasText: '年に一度の予定' });
    await expect(monthEvent).toBeVisible();
    await page.getByRole('tab', { name: '週', exact: true }).click();
    await expect(page.locator('.schedule-week-block').filter({ hasText: '年に一度の予定' })).toHaveCount(1);
    await page.getByRole('tab', { name: '日', exact: true }).click();
    const dayEvent = page.locator('.timeline-plan-block').filter({ hasText: '年に一度の予定' });
    await expect(dayEvent).toHaveCount(1);
    await dayEvent.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`yearly-next-year-${width}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
    await expect(dayEvent).toHaveCount(0);
    expect(await savedEvents(page)).toEqual([saved]);
    expect(errors).toEqual([]);
  });
}

test('an unbounded yearly series keeps next year after a single edit and reload', async ({ page }, testInfo) => {
  const originalTitle = '翌年も残る年次予定';
  const editedTitle = '今年だけ変更した予定';
  const year = Number(E2E_TODAY.slice(0, 4));
  const anchorDate = `${year - 1}${E2E_TODAY.slice(4)}`;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await seedHomeAdd(page);
  await page.goto('/');
  await page.getByRole('button', { name: '今日の予定に追加', exact: true }).click();
  await page.getByRole('button', { name: '学習予定を追加', exact: true }).click();
  const quickEntry = page.getByRole('dialog', { name: '予定・記録の追加' });
  await quickEntry.getByRole('button', { name: '繰り返し', exact: true }).click();
  await quickEntry.getByPlaceholder('例: 英語課題 / 面接準備').fill(originalTitle);
  await quickEntry.getByRole('button', { name: '毎年', exact: true }).click();
  await quickEntry.getByLabel('開始日', { exact: true }).fill(anchorDate);
  await quickEntry.getByLabel('開始時刻', { exact: true }).fill('19:00');
  await quickEntry.getByRole('button', { name: '30分', exact: true }).click();
  await quickEntry.getByRole('button', { name: '保存', exact: true }).click();
  await expect(quickEntry).toHaveCount(0);
  await expect.poll(async () => (await savedEvents(page)).length).toBe(1);
  const source = (await savedEvents(page))[0];
  expect(source).toMatchObject({ date: anchorDate, title: originalTitle,
    recurrence: { repeat: 'yearly', repeatUntil: null, rules: [{ kind: 'yearly', startDate: anchorDate, until: null }] } });

  // Creation selects the anchor date; reload returns to today's occurrence.
  await page.reload();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  await page.locator('.timeline-plan-block').filter({ hasText: originalTitle }).click();
  await page.getByRole('dialog', { name: `${originalTitle}の操作`, exact: true })
    .getByRole('button', { name: '予定を編集', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '学習予定を編集', exact: true });
  await editor.getByRole('textbox', { name: '予定名', exact: true }).fill(editedTitle);
  await editor.getByRole('button', { name: '学習予定を更新', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const scope = page.locator('.modal-card').filter({
    has: page.getByRole('heading', { name: '繰り返し予定の更新範囲', exact: true }),
  });
  await scope.getByRole('button', { name: /^この予定だけ/ }).click();
  await expect(scope).toHaveCount(0);
  await expect(page.locator('.timeline-plan-block').filter({ hasText: editedTitle })).toHaveCount(1);
  const edited = await savedEvents(page);
  expect(edited).toHaveLength(1);
  expect(edited[0]).toMatchObject({ id: source.id, date: anchorDate, title: originalTitle,
    recurrence: { repeat: 'yearly', repeatUntil: null, excludedDates: [] } });
  expect(edited[0].recurrence.rules).toHaveLength(2);
  expect(edited[0].recurrence.rules).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'yearly', startDate: anchorDate, until: null, title: originalTitle }),
    expect.objectContaining({ kind: 'date', dates: [E2E_TODAY], until: E2E_TODAY, title: editedTitle, isOverride: true }),
  ]));

  // Reopen the actual app from persisted storage; no fixture changes after creation.
  await page.reload();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const editedOccurrence = page.locator('.timeline-plan-block').filter({ hasText: editedTitle });
  await expect(editedOccurrence).toHaveCount(1);
  await expect(page.locator('.timeline-plan-block').filter({ hasText: originalTitle })).toHaveCount(0);
  await editedOccurrence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('yearly-single-edit-reloaded.png'), animations: 'disabled' });

  // Use the calendar's own year picker rather than replacing the clock or stored data.
  await page.locator('.schedule-period-picker-trigger').click();
  const picker = page.locator('.month-picker-modal');
  await expect(picker.locator('.month-picker-summary')).toHaveText(`${year}年${Number(E2E_TODAY.slice(5, 7))}月`);
  await picker.getByRole('button', { name: `${year + 1}年`, exact: true }).click();
  await expect(picker.locator('.month-picker-summary')).toHaveText(`${year + 1}年${Number(E2E_TODAY.slice(5, 7))}月`);
  await picker.getByRole('button', { name: '決定', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const nextYearOccurrence = page.locator('.timeline-plan-block').filter({ hasText: originalTitle });
  await expect(nextYearOccurrence).toHaveCount(1);
  await expect(editedOccurrence).toHaveCount(0);
  await expect(page.locator('.schedule-day-strip button[aria-current="date"]'))
    .toHaveAttribute('aria-label', new RegExp(`^${year + 1}年 ${Number(E2E_TODAY.slice(5, 7))}月${Number(E2E_TODAY.slice(8))}日 `));
  await nextYearOccurrence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('yearly-single-edit-next-year-preserved.png'), animations: 'disabled' });
  expect(await savedEvents(page)).toEqual(edited);
  expect(errors).toEqual([]);
});
