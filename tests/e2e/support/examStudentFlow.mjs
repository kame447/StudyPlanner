import { expect } from '@playwright/test';
import { CLOCK, SEED_IDS, BULK_PROMPT, STRATEGY_DECLINE_PROMPT } from './examStudentScenario.mjs';
import { classifyTitle } from './examStudentOracle.mjs';

// Browser helpers for the exam-student persona (reuse of the W3 synthetic save/reload pattern).
export const nav = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
export const composer = page => page.locator('.ai-planning-composer textarea');
export const previewDialog = page => page.getByRole('dialog', { name: '計画プレビュー' });
const previewButton = page => page.getByRole('button', { name: '計画プレビューを確認' });

/** Fail closed: only loopback may be contacted. The provider double is answered in the page. */
export async function installGuards(page, externalRequests) {
  await page.route('**/*', route => {
    const { hostname, href } = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return route.continue();
    externalRequests.push(href);
    return route.abort();
  });
  await page.clock.install({ time: new Date(CLOCK) });
  const skip = await import('./startup-ready.mjs').catch(() => null);
  if (skip) await skip.installStartupSkip(page);
}
export async function boot(page, seed = 'full', query = '') {
  await page.goto(`/weekly-real-exam-student.html?seed=${seed}${query}`);
  await expect(nav(page)).toBeVisible();
}
export async function openWeekly(page) {
  await nav(page).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
}
export async function send(page, text) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}
const turns = page => page.evaluate(() => window.__examHarness.providerCalls.filter(name => name.includes('semantic')).length);
/** Send a turn and wait for the application to finish it (the semantic call plus the composer re-enabled). */
export async function sendAndSettle(page, text) {
  const before = await turns(page);
  await send(page, text);
  await expect.poll(() => turns(page), { message: 'a semantic turn ran' }).toBe(before + 1);
  await expect(composer(page)).toBeEnabled();
  await page.waitForFunction(() => !document.querySelector('.ai-planning-composer [aria-busy="true"]'));
}
export const harness = page => page.evaluate(() => window.__examHarness);
export const rendererDecisions = async page => (await harness(page)).rendererRequests.map(payload => payload.applicationDecision);

/** Bulk request, then (if the product holds the preview for its spaced-memory proposal) decline that proposal. */
export async function bulkToPreview(page) {
  await sendAndSettle(page, BULK_PROMPT);
  await expect(composer(page)).toBeEnabled();
  if (await previewButton(page).count() === 0) await sendAndSettle(page, STRATEGY_DECLINE_PROMPT);
  await expect(previewButton(page)).toBeVisible({ timeout: 30_000 });
}

const SEED_YEAR = 2026;
/** Preview blocks with their day column, as rendered in the open preview dialog. */
export async function capturePreview(page) {
  if (!await previewDialog(page).isVisible()) await previewButton(page).click();
  const dialog = previewDialog(page);
  await expect(dialog).toBeVisible();
  const raw = await dialog.locator('.ai-planning-draft-block').evaluateAll(blocks => blocks.map(block => ({
    column: block.closest('.ai-planning-day-column')?.getAttribute('aria-label') ?? '',
    title: block.querySelector('strong')?.textContent ?? '', time: block.querySelector('small')?.textContent ?? '',
  })));
  return raw.map(({ column, title, time }) => {
    const [, month, day] = /^(\d+)\/(\d+)/.exec(column) ?? [];
    const [, startTime, endTime] = /^(\d\d:\d\d)-(\d\d:\d\d)/.exec(time) ?? [];
    return { title: title.trim(), date: `${SEED_YEAR}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, startTime, endTime };
  });
}
export async function closePreview(page) {
  if (await previewDialog(page).isVisible()) await previewDialog(page).getByRole('button', { name: '閉じる' }).first().click();
  await expect(previewDialog(page)).toHaveCount(0);
}
export async function promoteAndApprove(page, { double = false } = {}) {
  if (!await previewDialog(page).isVisible()) await previewButton(page).click();
  const dialog = previewDialog(page);
  await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  const approve = dialog.getByRole('button', { name: 'この内容で保存' });
  await expect(approve).toBeVisible();
  if (double) await approve.evaluate(button => { button.click(); button.click(); });
  else await approve.click();
}

/** Every durable plan row (legacy plans store plus canonical events), deduplicated by identity only. */
export async function durableRows(page) {
  return page.evaluate(() => {
    const read = key => JSON.parse(localStorage.getItem(key) ?? '[]');
    const pick = row => ({ title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime });
    const rows = [
      ...read('studyplanner.plans').map(row => ({ id: row.id, ...pick(row) })),
      ...read('studyplanner.scheduleEvents.v1').filter(row => row.provenance?.legacy?.kind === 'plan').map(row => ({ id: row.provenance.legacy.id, ...pick(row) })),
    ];
    // The legacy store and the canonical events carry the same record: identity, never content, deduplicates.
    return [...new Map(rows.map(row => [row.id, row])).values()];
  });
}
const sortRows = rows => [...rows].sort((a, b) => (a.date + a.startTime + a.title).localeCompare(b.date + b.startTime + b.title));
export const content = row => ({ title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime });
/** Saved weekly-planning blocks = durable rows that are not the persona's seeded events/buffers. */
export async function savedStudyBlocks(page) {
  const rows = (await durableRows(page)).filter(row => !SEED_IDS.has(row.id));
  return sortRows(rows);
}
export async function seededRows(page) {
  return sortRows((await durableRows(page)).filter(row => SEED_IDS.has(row.id)));
}

async function openSchedule(page, mode) {
  await nav(page).getByRole('button', { name: '予定', exact: true }).click();
  await page.getByRole('tab', { name: mode, exact: true }).click();
}
async function weekEntries(page) {
  await expect(page.locator('.schedule-week-day-column')).toHaveCount(7);
  return page.locator('.schedule-week-day-column').evaluateAll(columns => columns.flatMap(column => {
    const [, year, month, day] = /(\d+)年(\d+)月(\d+)日/.exec(column.getAttribute('aria-label'));
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return [...column.querySelectorAll('[aria-label*="から"]')].map(entry => {
      const [, title, startTime, endTime] = /^(.*) (\d\d:\d\d)から(\d\d:\d\d)。/.exec(entry.getAttribute('aria-label'));
      return { title, date, startTime, endTime };
    });
  }));
}
/** Study + seeded entries rendered by the week view for 2026-10-12..18 (clock is Fri 10/9, so one step forward). */
export async function weekViewEntries(page) {
  await openSchedule(page, '週');
  await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
  return weekEntries(page);
}
export async function dayViewEntries(page) {
  await openSchedule(page, '日');
  const trigger = page.locator('.schedule-period-picker-trigger');
  const found = [];
  for (const day of [12, 13, 14, 15, 16, 17, 18]) {
    for (let step = 0; step < 14; step += 1) {
      const [, month, current] = /(\d+)月(\d+)日/.exec(await trigger.textContent());
      if (Number(month) === 10 && Number(current) === day) break;
      const forward = Number(month) < 10 || (Number(month) === 10 && Number(current) < day);
      await page.getByRole('button', { name: forward ? '次の期間へ' : '前の期間へ', exact: true }).click();
      await expect(trigger).not.toContainText(`${month}月${current}日`);
    }
    for (const text of await page.locator('.timeline-plan-block').allTextContents()) {
      const [, title, startTime, endTime] = /^(.*?)(\d\d:\d\d)-(\d\d:\d\d)/.exec(text);
      found.push({ title: title.trim(), date: `2026-10-${String(day).padStart(2, '0')}`, startTime, endTime });
    }
  }
  return found;
}
export const studyOnly = rows => rows.filter(row => classifyTitle(row.title) !== null);
export const byDate = sortRows;

const minutesText = minutes => (minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`);
const toMinutes = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Month grid: rendered 目標 text per day of October must equal the saved study minutes of that day. */
export async function expectMonthMatches(page, saved) {
  await openSchedule(page, '月');
  const grid = page.getByRole('grid', { name: '月間カレンダー' });
  await expect(grid).toBeVisible();
  const month = await grid.locator('[role="gridcell"]:not(.is-muted)').evaluateAll(cells => Object.fromEntries(cells.map(cell => {
    const day = Number(cell.querySelector('.month-date-number').textContent);
    const [, target] = /目標 (\S+?)記録/.exec(cell.textContent) ?? [];
    return [day, target ?? null];
  })));
  const expected = {};
  for (const row of saved) {
    const day = Number(row.date.slice(8));
    expected[day] = (expected[day] ?? 0) + toMinutes(row.endTime) - toMinutes(row.startTime);
  }
  for (const [day, target] of Object.entries(month)) expect(target, `month cell ${day}`).toBe(minutesText(expected[day] ?? 0));
}
