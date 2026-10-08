import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';
const OWNER = 'day-occurrence-owner';
async function timedPhase(name, run) {
  const startedAt = performance.now();
  console.log('Day occurrence phase:', JSON.stringify({ name, state: 'started' }));
  try {
    return await test.step(name, run);
  } finally {
    console.log('Day occurrence phase:', JSON.stringify({ name, state: 'finished', elapsedMs: Math.round(performance.now() - startedAt) }));
  }
}
async function attachScreen(page, testInfo, name) {
  await timedPhase(`capture ${name}`, async () => {
    const path = testInfo.outputPath('attachments', `${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  });
}
async function seed(page) {
  await page.addInitScript(({ date, owner }) => {
    if (localStorage.getItem('day-occurrence-controls-seeded')) return;
    const base = { userId: owner, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const template = { ...base, id: 'class-1', title: '自動表示の授業', subject: '数学', type: 'school-event', weekday: 'wed',
      termId: 'term', periodNumber: 1, startTime: '10:00', endTime: '11:00', memo: '', active: true };
    const plan = { ...base, id: 'recurring-plan', seriesId: 'recurring-plan', title: '毎週の学習', subject: '数学', type: 'study', date,
      startTime: '13:00', endTime: '14:00', repeat: 'weekly', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '' };
    const actual = { id: 'plan-actual', userId: owner, planId: plan.id, occurrenceDate: date, actualStartTime: '13:00', actualEndTime: '14:00',
      subject: '数学', note: '残す記録', updatedAt: base.updatedAt };
    const entries = {
      'studyplanner.users': [{ id: owner, email: 'day-occurrence@example.test', username: '日表示', avatar: '', createdAt: base.createdAt }],
      'studyplanner.timetableTerms.v1': [{ ...base, id: 'term', year: 2026, kind: 'fullYear', label: '2026年', isActive: true }],
      'studyplanner.scheduleTemplates.v1': [template, { ...template, id: 'class-2', periodNumber: 2, startTime: '11:00', endTime: '12:00' }],
      'studyplanner.plans': [plan, { ...plan, id: 'imported', seriesId: 'imported', title: '保存済み授業', repeat: 'none', sourceType: 'timetable', sourceId: 'saved-template', startTime: '16:00', endTime: '17:00' }],
      'studyplanner.monthEvents': [{ ...base, id: 'event', title: '毎週の予定', date, startTime: '14:00', endTime: '15:00',
        repeat: 'weekly', repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [] }],
      'studyplanner.actuals': [actual, { ...actual, id: 'event-actual', planId: 'event', actualStartTime: '14:00', actualEndTime: '15:00' }],
      'studyplanner.timetablePeriods.v1': [], 'studyplanner.todos.v1': [], 'studyplanner.studySubjects.v1': [], 'studyplanner.studyMaterials.v1': [],
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('studyplanner.session', owner); localStorage.setItem('day-occurrence-controls-seeded', 'true');
  }, { date: E2E_TODAY, owner: OWNER });
}
async function openDay(page) {
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
}
const card = (page, title) => page.locator('.timeline-plan-block').filter({ hasText: title });
const actuals = page => page.evaluate(() => localStorage.getItem('studyplanner.actuals'));
async function setVisible(page, visible) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const setting = page.getByRole('group', { name: '日カレンダーに時間割を表示', exact: true });
  await setting.getByRole('button', { name: visible ? '表示する' : '表示しない', exact: true }).click();
  await expect(setting.getByRole('button', { name: visible ? '表示する' : '表示しない', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.app-settings-page').getByRole('button', { name: '戻る', exact: true }).click();
}
for (const width of [390, 1280]) {
  test(`day visibility and single-occurrence cancellation preserve recorded history at ${width}px`, async ({ page }, testInfo) => {
    await timedPhase('open seeded Day', async () => {
      await page.setViewportSize({ width, height: 900 }); await seed(page); await page.goto('/'); await openDay(page);
      await expect(card(page, '自動表示の授業')).toHaveCount(1);
    });
    const savedActuals = await actuals(page);
    await timedPhase('visibility preference persists independently of Month', async () => {
      await setVisible(page, false);
      await expect(card(page, '自動表示の授業')).toHaveCount(0);
      await expect(card(page, '保存済み授業')).toHaveCount(1);
      await expect(page.locator('.timeline-actual-block')).toHaveCount(2);
      await page.reload(); await openDay(page); await expect(card(page, '自動表示の授業')).toHaveCount(0);
      await page.getByRole('tab', { name: '月', exact: true }).click();
      await expect(page.getByRole('grid', { name: '月間カレンダー' })).toContainText('自動表示の授業');
      await page.getByRole('tab', { name: '日', exact: true }).click(); await setVisible(page, true);
    });
    await timedPhase('timetable target geometry, cancellation and Undo', async () => {
      await card(page, '自動表示の授業').click();
      await expect(page.getByRole('dialog', { name: '自動表示の授業の詳細', exact: true })).toBeVisible();
      await attachScreen(page, testInfo, `day-timetable-detail-${width}`);
      const deletionBounds = await page.getByRole('dialog', { name: '自動表示の授業の詳細', exact: true })
        .getByRole('button', { name: 'この日だけ削除', exact: true }).evaluate(button => {
          const control = button.getBoundingClientRect();
          const dialog = button.closest('[role="dialog"]').getBoundingClientRect();
          return { height: control.height, left: control.left, right: control.right, top: control.top, bottom: control.bottom,
            dialogLeft: dialog.left, dialogRight: dialog.right, dialogTop: dialog.top, dialogBottom: dialog.bottom,
            viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
        });
      console.log('Day timetable deletion control bounds:', JSON.stringify({ width, ...deletionBounds }));
      // Existing modal ghost buttons keep at least 40px on the narrow breakpoint.
      expect(deletionBounds.height).toBeGreaterThanOrEqual(40);
      expect(deletionBounds.left).toBeGreaterThanOrEqual(deletionBounds.dialogLeft);
      expect(deletionBounds.right).toBeLessThanOrEqual(deletionBounds.dialogRight);
      expect(deletionBounds.top).toBeGreaterThanOrEqual(deletionBounds.dialogTop);
      expect(deletionBounds.bottom).toBeLessThanOrEqual(deletionBounds.dialogBottom);
      expect(deletionBounds.left).toBeGreaterThanOrEqual(0);
      expect(deletionBounds.right).toBeLessThanOrEqual(deletionBounds.viewportWidth);
      expect(deletionBounds.top).toBeGreaterThanOrEqual(0);
      expect(deletionBounds.bottom).toBeLessThanOrEqual(deletionBounds.viewportHeight);
      await page.getByRole('dialog', { name: '自動表示の授業の詳細', exact: true }).getByRole('button', { name: 'この日だけ削除', exact: true }).click();
      await expect(card(page, '自動表示の授業')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleTemplates.v1')).map(row => row.excludedDates))).toEqual([[E2E_TODAY], [E2E_TODAY]]);
      await page.getByRole('button', { name: '元に戻す', exact: true }).click();
      await expect(card(page, '自動表示の授業')).toHaveCount(1);
    });
    await timedPhase('cancel recurring occurrences and inspect retained Actual', async () => {
      for (const title of ['毎週の学習', '毎週の予定']) {
        await card(page, title).click();
        await page.getByRole('dialog', { name: `${title}の操作`, exact: true }).getByRole('button', { name: 'この日だけ削除', exact: true }).click();
        await expect(card(page, title)).toHaveCount(0);
      }
      await expect(page.locator('.timeline-actual-block')).toHaveCount(2); expect(await actuals(page)).toBe(savedActuals);
      await page.locator('.timeline-actual-block').first().click();
      await expect(page.getByRole('dialog')).toContainText('記録は残っています');
      await expect(page.getByRole('dialog').getByRole('button', { name: '記録を編集', exact: true })).toBeVisible();
      await attachScreen(page, testInfo, `day-retained-actual-${width}`);
      await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
    });
    await timedPhase('cancellation and Actual history survive reload', async () => {
      await page.reload(); await openDay(page);
      await expect(card(page, '毎週の学習')).toHaveCount(0); await expect(card(page, '毎週の予定')).toHaveCount(0);
      await expect(page.locator('.timeline-actual-block')).toHaveCount(2); expect(await actuals(page)).toBe(savedActuals);
    });
    await timedPhase('navigate seven days to the next occurrence', async () => {
      for (let day = 0; day < 7; day++) await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
    });
    await timedPhase('verify all three next-week occurrences remain', async () => {
      for (const title of ['毎週の学習', '毎週の予定', '自動表示の授業']) await expect(card(page, title)).toHaveCount(1);
    });
  });
}
