import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const HARNESS_URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
const navigate = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true }).click();
const counts = detail => detail.locator('.class-attendance-counts dd');

async function expectFrontmostOpaqueDialog(dialog) {
  // Ordinary save notices intentionally sit above dialogs for 3600ms. Inspect
  // the stable dialog after they expire; do not hide or lower application UI.
  await expect(dialog.page().locator('.app-toast-layer')).toHaveCount(0);
  const layout = await dialog.evaluate(node => {
    const overlay = node.closest('.timetable-class-overlay');
    const card = node.getBoundingClientRect(), veil = overlay.getBoundingClientRect();
    const body = node.querySelector('.timetable-editor-body').getBoundingClientRect();
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(node).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const alpha = context.getImageData(0, 0, 1, 1).data[3];
    const nav = document.querySelector('nav[aria-label="主要ナビゲーション"]');
    const coveredNav = [...nav.querySelectorAll('button')].every(button => {
      const rect = button.getBoundingClientRect();
      return overlay.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    const headerFrontmost = [...node.querySelectorAll('.timetable-editor-header button')].every(button => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    return { alpha, coveredNav, headerFrontmost, veil: [veil.x, veil.y, veil.right, veil.bottom],
      card: [card.x, card.y, card.right, card.bottom], bodyInside: body.top >= card.top && body.bottom <= card.bottom,
      viewport: [document.documentElement.clientWidth, innerHeight], focusInside: node.contains(document.activeElement), pageLocked: getComputedStyle(document.documentElement).overflowY === 'hidden' };
  });
  expect(layout.alpha).toBe(255);
  expect(layout.coveredNav).toBe(true);
  expect(layout.headerFrontmost, JSON.stringify(layout)).toBe(true);
  expect(layout.pageLocked).toBe(true);
  expect(layout.focusInside).toBe(true);
  expect(layout.bodyInside).toBe(true);
  expect(layout.veil[0]).toBe(0); expect(layout.veil[1]).toBe(0);
  expect(layout.veil[2]).toBe(layout.viewport[0]); expect(layout.veil[3]).toBe(layout.viewport[1]);
  expect(layout.card[0]).toBeGreaterThanOrEqual(0); expect(layout.card[1]).toBe(0);
  expect(layout.card[2]).toBeLessThanOrEqual(layout.viewport[0]); expect(layout.card[3]).toBe(layout.viewport[1]);
}

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
    await expectFrontmostOpaqueDialog(detail);
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
    await expect(schedule).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.matches('input, textarea, select'))).toBe(false);
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
    await expectFrontmostOpaqueDialog(editor);
    await editor.locator('.timetable-editor-options > summary').click();
    const body = editor.locator('.timetable-editor-body');
    const scroll = await body.evaluate(node => {
      node.scrollTop = node.scrollHeight;
      return { overflow: node.scrollHeight > node.clientHeight, offset: node.scrollTop };
    });
    if (scroll.overflow) expect(scroll.offset).toBeGreaterThan(0);
    await expectFrontmostOpaqueDialog(editor);
    const editorScreenshot = testInfo.outputPath(`lesson-editor-${viewport.width}-${viewport.theme}.png`);
    await page.screenshot({ path: editorScreenshot });
    await testInfo.attach('Opaque class editor with contained optional details', { path: editorScreenshot, contentType: 'image/png' });
    await editor.getByLabel('授業名', { exact: true }).fill('数理論理・改');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
    await page.reload();
    await page.waitForFunction(() => window.__plannerRecoveryHook?.snapshot?.().ready === true);
    await navigate(page, '時間割');
    const reopenedLauncher = page.getByRole('button', { name: '月曜 1限 数理論理・改の詳細', exact: true });
    await reopenedLauncher.focus();
    await reopenedLauncher.click();
    const reopened = page.getByRole('dialog', { name: '数理論理・改の詳細', exact: true });
    await expect(counts(reopened)).toHaveText(['0', '1', '0']);
    await expectFrontmostOpaqueDialog(reopened);
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
    await page.screenshot({ path: screenshot });
    await testInfo.attach('Lesson summary with saved attendance and related schedule', { path: screenshot, contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(reopened).toHaveCount(0);
    await expect(reopenedLauncher).toBeFocused();
  });
}
