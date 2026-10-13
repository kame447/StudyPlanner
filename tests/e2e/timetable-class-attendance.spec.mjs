import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const HARNESS_URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
const navigate = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true }).click();
const counts = detail => detail.locator('.class-attendance-counts dd');

for (const viewport of [
  { width: 1280, height: 900, theme: 'light' },
  { width: 390, height: 844, theme: 'dark' },
  { width: 320, height: 640, theme: 'light' },
]) {
  test(`lesson detail, attendance correction and related schedule survive reload ${viewport.width}-${viewport.theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto(`${HARNESS_URL}?theme=${viewport.theme}`);
    await page.waitForFunction(() => window.__plannerRecoveryHook?.snapshot?.().ready === true);
    await page.evaluate(() => window.__plannerRecoveryHook.startTimetableClass({ title: '数理論理', periodNumber: 1 }));
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
    await navigate(page, '時間割');
    await page.getByRole('button', { name: '月曜 1限 数理論理の詳細', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '数理論理の詳細', exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.locator('form')).toHaveCount(0);
    await expect(counts(detail)).toHaveText(['0', '0', '0']);
    await detail.getByRole('button', { name: '記録', exact: true }).click();
    const form = detail.getByRole('form', { name: '出欠を記録' });
    await form.getByLabel('実施日').fill(E2E_TODAY);
    await form.getByRole('button', { name: '出席', exact: true }).click();
    await form.evaluate(node => { node.requestSubmit(); node.requestSubmit(); });
    await expect(form).toHaveCount(0);
    await expect(counts(detail)).toHaveText(['1', '0', '0']);
    await detail.locator('.class-detail-history > summary').first().click();
    await detail.getByRole('button', { name: `${E2E_TODAY} 出席を訂正`, exact: true }).click();
    await form.getByRole('button', { name: '欠席', exact: true }).click();
    await form.getByRole('button', { name: '保存', exact: true }).click();
    await expect(counts(detail)).toHaveText(['0', '1', '0']);

    await detail.getByRole('button', { name: '追加', exact: true }).click();
    const schedule = detail.getByRole('form', { name: '授業の予定を追加' });
    await schedule.getByLabel('予定名', { exact: true }).fill('論理レポート提出');
    await schedule.getByLabel('日付', { exact: true }).fill(E2E_TODAY);
    await schedule.getByLabel('開始', { exact: true }).fill('17:00');
    await schedule.getByLabel('終了', { exact: true }).fill('17:15');
    await schedule.getByRole('button', { name: '予定を追加', exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect(detail.getByText('論理レポート提出', { exact: true })).toBeVisible();
    const stored = await page.evaluate(() => {
      const template = JSON.parse(localStorage.getItem('studyplanner.scheduleTemplates.v1')).find(row => row.title === '数理論理');
      const events = JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1'));
      const records = Object.keys(localStorage).filter(key => key.startsWith('studyplanner.classAttendance.v1:')).map(key => JSON.parse(localStorage.getItem(key)));
      return { template, events, records, actuals: JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]') };
    });
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0]).toMatchObject({ templateId: stored.template.id, date: E2E_TODAY, status: 'absent' });
    expect(stored.events.filter(event => event.plan?.classTemplateId === stored.template.id)).toEqual([
      expect.objectContaining({ title: '論理レポート提出', category: 'deadline', provenance: expect.objectContaining({ sourceType: 'manual', sourceId: null }) }),
    ]);
    expect(stored.actuals).toEqual([]);

    await detail.getByRole('button', { name: '編集', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '授業を編集', exact: true });
    await expect(editor.getByLabel('教科', { exact: true })).toBeHidden();
    await editor.getByLabel('授業名', { exact: true }).fill('数理論理・改');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
    await page.reload();
    await page.waitForFunction(() => window.__plannerRecoveryHook?.snapshot?.().ready === true);
    await navigate(page, '時間割');
    await page.getByRole('button', { name: '月曜 1限 数理論理・改の詳細', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: '数理論理・改の詳細', exact: true });
    await expect(counts(reopened)).toHaveText(['0', '1', '0']);
    await expect(reopened.getByText('論理レポート提出', { exact: true })).toBeVisible();
    const geometry = await reopened.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    const screenshot = testInfo.outputPath(`lesson-detail-${viewport.width}-${viewport.theme}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('Lesson summary with saved attendance and related schedule', { path: screenshot, contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(reopened).toHaveCount(0);
  });
}
