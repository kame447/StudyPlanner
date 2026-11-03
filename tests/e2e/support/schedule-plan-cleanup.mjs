// Shared cleanup for plans the AI planner saved on the schedule day view (Issue #926 production smoke).
// Contract mirrored from the product, never guessed:
//  - a saved plan is a `.timeline-plan-block` (not `.timeline-draft-block`) whose title attribute is
//    `<title> / <start>-<end> / <subject>` (DayTimeline.tsx);
//  - clicking it opens the dialog named `<title>の操作` (DayDetailModal.tsx) whose danger actions come from
//    dayOccurrenceCancellationPresentation.ts: a one-off plan has exactly one, '予定を削除'; a recurring plan
//    has 'この日だけ削除' / 'この回だけ削除' (+ whole-series '削除'). A series is never deleted here.
// Nothing sleeps: every step waits on a count or visibility.
import { expect } from '@playwright/test';

export const ONE_OFF_DELETE_LABEL = '予定を削除';
const SAVED_PLAN_BLOCK = '.timeline-plan-block:not(.timeline-draft-block)';
const WAIT = { timeout: 30_000 };

const dayLabel = date => {
  const day = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日`;
};
const attributeValue = value => value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');

/** Opens the schedule day view on `date` (Date at UTC midnight or 'YYYY-MM-DD'), stepping forward. */
export async function openScheduleDay(page, date) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const label = dayLabel(date);
  const shown = () => page.getByText(label).first().isVisible();
  // The day view opens on the selected date (today by default); every target date is in the future.
  for (let step = 0; step < 70 && !(await shown()); step++) {
    await page.getByRole('button', { name: '次の期間へ' }).click();
  }
  if (!(await shown())) throw new Error(`The day view never showed ${label}.`);
}

const entriesTitled = (page, title) => page.locator(`${SAVED_PLAN_BLOCK}[title^="${attributeValue(`${title} / `)}"]`);

async function entryTitles(page, prefix) {
  const raw = await page.locator(SAVED_PLAN_BLOCK).evaluateAll(nodes => nodes.map(node => node.getAttribute('title') ?? ''));
  return [...new Set(raw.map(text => text.split(' / ')[0]).filter(title => title.startsWith(prefix)))];
}

/**
 * Deletes every saved one-off plan titled exactly `title` on the open day and proves none remain.
 * `deleteLabels` is the product's accepted label set for a one-off plan; a plan whose danger action is
 * anything else (a recurring series, a changed label) fails loudly instead of deleting.
 */
async function removeVisibleTitled(page, title, deleteLabels) {
  const entries = entriesTitled(page, title);
  let remaining = await entries.count();
  while (remaining > 0) {
    await entries.first().click();
    const menu = page.getByRole('dialog', { name: `${title}の操作`, exact: true });
    await expect(menu).toBeVisible(WAIT);
    const danger = menu.locator('.schedule-action-item.danger');
    const labels = await danger.locator('strong').allTextContents();
    if (labels.length !== 1 || !deleteLabels.includes(labels[0].trim())) {
      throw new Error(`Refusing to delete: the plan menu offers [${labels.join(', ')}], expected one of [${deleteLabels.join(', ')}] only.`);
    }
    await danger.first().click();
    await expect(menu).toHaveCount(0, WAIT);
    await expect(entries, 'deleting must remove exactly one entry').toHaveCount(remaining - 1, WAIT);
    remaining -= 1;
  }
  await expect(entries).toHaveCount(0, WAIT);
}

export async function removeSavedPlansByTitle(page, { title, date, deleteLabels = [ONE_OFF_DELETE_LABEL] }) {
  expect(title, 'cleanup needs the exact unique title').toBeTruthy();
  await openScheduleDay(page, date);
  await removeVisibleTitled(page, title, deleteLabels);
}

/**
 * Removes leftovers of earlier failed runs: every saved plan whose title starts with `titlePrefix`
 * on each of `dates`. Returns the number of distinct leftover titles removed so the caller can report it.
 */
export async function sweepLeftoverPlans(page, { titlePrefix = 'E2E-E2E-VNEXT-', dates, deleteLabels = [ONE_OFF_DELETE_LABEL] }) {
  expect(titlePrefix.length, 'the sweep prefix must be specific').toBeGreaterThanOrEqual(8);
  let removed = 0;
  for (const date of dates) {
    await openScheduleDay(page, date);
    for (const title of await entryTitles(page, titlePrefix)) {
      await removeVisibleTitled(page, title, deleteLabels);
      removed += 1;
    }
    expect(await entryTitles(page, titlePrefix), `no ${titlePrefix} plan may remain on ${dayLabel(date)}`).toEqual([]);
  }
  return removed;
}

/** Negative self-check for specs: a wrong delete label must fail and must leave the plan in place. */
export async function expectCleanupLabelMismatchFails(page, { title, date }) {
  await openScheduleDay(page, date);
  const before = await entriesTitled(page, title).count();
  expect(before, 'the self-check needs a saved plan').toBeGreaterThan(0);
  await expect(removeVisibleTitled(page, title, ['削除'])).rejects.toThrow(/Refusing to delete/u);
  await page.getByRole('dialog', { name: `${title}の操作`, exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(entriesTitled(page, title)).toHaveCount(before);
}
