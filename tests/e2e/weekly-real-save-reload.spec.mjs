import { expect, test } from '@playwright/test';

// Synthetic isolated save E2E (not Firestore, not online).
// REAL: production App, planner hooks, turn runtime/controller/reducer, approval application,
//       AiPlanningView, Week/Day/Month views, and the production local repository over this
//       browser profile's localStorage. SUBSTITUTED: only the provider wire (authored replies for
//       a `.invalid` base URL, answered inside the page) and the durable store (localStorage).
// Every oracle reads rendered DOM or durable store contents, never repository read-method counts.

const HARNESS = '/weekly-real-save-reload.html?scenario=S';
const CLOCK = new Date('2026-10-07T18:00:00+09:00');
// Scripted request: window 10/8-10/14, 60 pages x 3 min, weekdays from 20:00 => three 70-minute
// blocks produced by the real scheduler. Two land in the displayed week (10/5-10/11), one in the next.
const EXPECTED = [
  { date: '2026-10-08', startTime: '20:00', endTime: '21:10' },
  { date: '2026-10-09', startTime: '20:00', endTime: '21:10' },
  { date: '2026-10-12', startTime: '20:00', endTime: '21:10' },
];
const TITLE = /^アルゴリズムイントロダクション 20ページ（\d+〜\d+ページ）$/;

const externalRequests = [];

test.beforeEach(async ({ page }) => {
  externalRequests.length = 0;
  // Fail closed: only loopback may be contacted. The provider double never issues a request.
  await page.route('**/*', route => {
    const { hostname, href } = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return route.continue();
    externalRequests.push(href);
    return route.abort();
  });
  await page.clock.install({ time: CLOCK });
});

test.afterEach(async () => {
  expect(externalRequests, 'no request may leave loopback').toEqual([]);
});

const nav = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
const composer = page => page.locator('.ai-planning-composer textarea');
const previewDialog = page => page.getByRole('dialog', { name: '計画プレビュー' });

async function boot(page) {
  await page.goto(HARNESS);
  await expect(nav(page)).toBeVisible();
}
async function openWeekly(page) {
  await nav(page).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
}
async function sendScriptedTurn(page) {
  await composer(page).fill(await page.evaluate(() => window.__weeklySaveHarness.texts[0]));
  await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
}
async function openPreview(page) {
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  await expect(previewDialog(page)).toBeVisible();
  return previewDialog(page);
}
async function previewBlocks(page) {
  const texts = await (await openPreview(page)).locator('.ai-planning-draft-block').allTextContents();
  return texts.map(text => {
    const [, title, startTime, endTime] = /^(.*?)(\d\d:\d\d)-(\d\d:\d\d)/.exec(text);
    return { title: title.trim(), startTime, endTime };
  });
}
async function promoteAndApprove(page, { double = false } = {}) {
  const preview = previewDialog(page);
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  const approve = preview.getByRole('button', { name: 'この内容で保存' });
  await expect(approve).toBeVisible();
  if (double) {
    // Two clicks in the same task, before React can re-render the first one's pending state.
    await approve.evaluate(button => { button.click(); button.click(); });
  } else {
    await approve.click();
  }
}
async function startPreview(page) {
  await boot(page);
  await openWeekly(page);
  await sendScriptedTurn(page);
}
async function approveFirstPreview(page, options) {
  const preview = await previewBlocks(page);
  await promoteAndApprove(page, options);
  await expect(previewDialog(page)).toHaveCount(0);
  return preview;
}

/** Durable plan rows from every plan-bearing key, deduplicated only by identity, never by content. */
async function durablePlans(page) {
  return page.evaluate(() => {
    const read = key => JSON.parse(localStorage.getItem(key) ?? '[]');
    const fromPlans = read('studyplanner.plans').map(row => ({ id: row.id, ...pick(row) }));
    const fromEvents = read('studyplanner.scheduleEvents.v1')
      .filter(row => row.provenance?.legacy?.kind === 'plan')
      .map(row => ({ id: row.provenance.legacy.id, ...pick(row) }));
    function pick(row) {
      return { title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime };
    }
    return [...fromPlans, ...fromEvents];
  });
}
const byDate = rows => [...rows].sort((a, b) => (a.date + a.startTime + a.title).localeCompare(b.date + b.startTime + b.title));
const content = row => ({ title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime });

async function expectDurable(page, preview) {
  const rows = byDate(await durablePlans(page));
  expect(rows, 'exactly the previewed blocks are stored').toHaveLength(EXPECTED.length);
  expect(new Set(rows.map(row => row.id)).size, 'distinct record ids').toBe(rows.length);
  expect(rows.map(row => ({ date: row.date, startTime: row.startTime, endTime: row.endTime })), 'saved times').toEqual(EXPECTED);
  for (const row of rows) expect(row.title).toMatch(TITLE);
  expect(rows.map(row => ({ title: row.title, startTime: row.startTime, endTime: row.endTime })), 'saved equals previewed')
    .toEqual(preview);
  return rows;
}

async function openSchedule(page, mode) {
  await nav(page).getByRole('button', { name: '予定', exact: true }).click();
  await page.getByRole('tab', { name: mode, exact: true }).click();
}
const next = page => page.getByRole('button', { name: '次の期間へ', exact: true }).click();

async function weekEntries(page) {
  await expect(page.locator('.schedule-week-day-column')).toHaveCount(7);
  // Entries of the displayed week, keyed by the ISO date of their column.
  return page.locator('.schedule-week-day-column').evaluateAll(columns => columns.flatMap(column => {
    const [, year, month, day] = /(\d+)年(\d+)月(\d+)日/.exec(column.getAttribute('aria-label'));
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return [...column.querySelectorAll('[aria-label*="アルゴリズム"]')].map(entry => {
      const [, title, startTime, endTime] = /^(.*) (\d\d:\d\d)から(\d\d:\d\d)。/.exec(entry.getAttribute('aria-label'));
      return { title, date, startTime, endTime };
    });
  }));
}
async function weekView(page) {
  await openSchedule(page, '週');
  const displayed = await weekEntries(page);
  await next(page);
  const following = await weekEntries(page);
  return { displayed, following };
}
async function gotoDay(page, date) {
  const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  const trigger = page.locator('.schedule-period-picker-trigger');
  // The selected date carries over from the week view, so step in whichever direction is needed.
  for (let step = 0; step < 14; step += 1) {
    const [, month, day] = /(\d+)月(\d+)日/.exec(await trigger.textContent());
    if (`${month}月${day}日` === label) return;
    const forward = Number(month) * 100 + Number(day) < Number(date.slice(5, 7)) * 100 + Number(date.slice(8));
    await page.getByRole('button', { name: forward ? '次の期間へ' : '前の期間へ', exact: true }).click();
    await expect(trigger).not.toContainText(`${month}月${day}日`);
  }
  throw new Error(`could not reach ${date}`);
}
async function dayView(page) {
  await openSchedule(page, '日');
  const found = [];
  for (const date of ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']) {
    await gotoDay(page, date);
    const blocks = await page.locator('.timeline-plan-block').allTextContents();
    for (const text of blocks) {
      const [, title, startTime, endTime] = /^(.*?)(\d\d:\d\d)-(\d\d:\d\d)/.exec(text);
      found.push({ title: title.trim(), date, startTime, endTime });
    }
  }
  return found;
}
async function monthTargets(page) {
  await openSchedule(page, '月');
  const grid = page.getByRole('grid', { name: '月間カレンダー' });
  await expect(grid).toBeVisible();
  // day-of-month -> rendered planned-minutes text, for the days of the displayed month only.
  return grid.locator('[role="gridcell"]:not(.is-muted)').evaluateAll(cells => Object.fromEntries(cells.map(cell => {
    const day = Number(cell.querySelector('.month-date-number').textContent);
    const [, target] = /目標 (\S+?)記録/.exec(cell.textContent) ?? [];
    return [day, target ?? null];
  })));
}
const minutesText = minutes => (minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`);
const minutes = row => {
  const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return toMinutes(row.endTime) - toMinutes(row.startTime);
};

/** Compare week/day/month rendered DOM with the saved records (counts included). */
async function expectViewsMatch(page, rows) {
  const stored = byDate(rows).map(content);
  const week = await weekView(page);
  expect(byDate(week.displayed), 'week view, displayed week').toEqual(stored.filter(row => row.date <= '2026-10-11'));
  expect(byDate(week.following), 'week view, following week').toEqual(stored.filter(row => row.date > '2026-10-11'));
  expect(byDate(await dayView(page)), 'day views').toEqual(stored);
  const month = await monthTargets(page);
  const expectedMonth = {};
  for (const row of stored) expectedMonth[Number(row.date.slice(8))] = (expectedMonth[Number(row.date.slice(8))] ?? 0) + minutes(row);
  for (const [day, target] of Object.entries(month)) {
    expect(target, `month cell ${day}`).toBe(minutesText(expectedMonth[day] ?? 0));
  }
}

test.describe('synthetic isolated save E2E (not Firestore, not online)', () => {
  test('approved preview is saved once, shown in week/day/month, and restored after reload', async ({ page }) => {
    await startPreview(page);
    // Nothing is durable until explicit approval.
    expect(await durablePlans(page)).toEqual([]);
    const preview = await approveFirstPreview(page);
    expect(preview).toHaveLength(EXPECTED.length);
    for (const block of preview) expect(block.title).toMatch(TITLE);

    const saved = await expectDurable(page, preview);
    await expectViewsMatch(page, saved);

    await page.reload();
    await expect(nav(page)).toBeVisible();
    const afterReload = await expectDurable(page, preview);
    expect(afterReload.map(row => row.id), 'same records after reload').toEqual(saved.map(row => row.id));
    await expectViewsMatch(page, afterReload);

    // The only provider traffic was answered by the in-page double, and nothing escaped loopback.
    const harness = await page.evaluate(() => window.__weeklySaveHarness);
    expect(harness.providerFailures).toEqual([]);
  });

  test('a double approval click and re-approving after reload create no duplicates', async ({ page }) => {
    await startPreview(page);
    const preview = await approveFirstPreview(page, { double: true });
    const saved = await expectDurable(page, preview);

    await page.reload();
    await expect(nav(page)).toBeVisible();
    await openWeekly(page);
    // The approved draft must not be offered for another approval after reload.
    await expect(page.getByRole('button', { name: 'この内容で保存' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toHaveCount(0);
    const afterReload = await expectDurable(page, preview);
    expect(afterReload.map(row => row.id)).toEqual(saved.map(row => row.id));
    await expectViewsMatch(page, afterReload);
  });

  test('a double submit is one turn and a resend after save creates no record without a new approval', async ({ page }, testInfo) => {
    await boot(page);
    await openWeekly(page);
    const text = await page.evaluate(() => window.__weeklySaveHarness.texts[0]);
    await composer(page).fill(text);
    await composer(page).evaluate(el => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
    expect(await page.locator('.ai-planning-message-row.user').count(), 'one user message').toBe(1);
    expect((await page.evaluate(() => window.__weeklySaveHarness.providerCalls)).filter(name => name.includes('semantic')))
      .toHaveLength(1);

    const preview = await approveFirstPreview(page);
    const saved = await expectDurable(page, preview);

    // Re-send the same message after saving. It may or may not offer a new preview; it must not save.
    await composer(page).fill(text);
    await composer(page).press('Enter');
    await expect(composer(page)).toBeEnabled();
    await page.waitForTimeout(500);
    expect(byDate(await durablePlans(page)), 'resend alone never writes').toEqual(saved);
    testInfo.annotations.push({
      type: 'observation',
      description: `resend after save offers a new preview: ${await page.getByRole('button', { name: '計画プレビューを確認' }).count() > 0}`,
    });
  });

  test('a failed save stays retryable and loses or duplicates nothing', async ({ page }) => {
    await startPreview(page);
    // Storage-boundary fault: the first durable write of an approved plan fails once.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failures = 0;
      window.__injectedStorageFailures = () => failures;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === 'studyplanner.scheduleEvents.v1' && failures === 0
          && String(value).includes('weekly-approval')) {
          failures += 1;
          throw new Error('Synthetic plan write failure');
        }
        return original.call(this, key, value);
      };
    });
    const preview = await previewBlocks(page);
    await promoteAndApprove(page);
    await expect.poll(() => page.evaluate(() => window.__injectedStorageFailures())).toBe(1);
    // The dialog stays open, says which part failed, and offers only the unsaved block again.
    const dialog = previewDialog(page);
    await expect(dialog.getByText('未保存分だけ再試行できます', { exact: false })).toBeVisible();
    const remaining = (await dialog.locator('.ai-planning-draft-block').allTextContents()).length;
    const partial = byDate(await durablePlans(page));
    expect(partial.length + remaining, 'every block is either stored or still retryable').toBe(EXPECTED.length);
    expect(partial.length, 'the failed write stored nothing for its block').toBe(EXPECTED.length - 1);
    expect(new Set(partial.map(row => row.id)).size).toBe(partial.length);
    const approve = dialog.getByRole('button', { name: 'この内容で保存' });
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(previewDialog(page)).toHaveCount(0);
    const saved = await expectDurable(page, preview);
    await expectViewsMatch(page, saved);
    await page.reload();
    await expect(nav(page)).toBeVisible();
    await expectViewsMatch(page, await expectDurable(page, preview));
  });
});
