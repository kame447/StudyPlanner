// Shared cleanup for plans the AI planner saved on the schedule day view (Issue #926 production smoke).
// Contract mirrored from the product, never guessed:
//  - a saved plan is a `.timeline-plan-block` (not `.timeline-draft-block`) whose title attribute is
//    `<title> / <start>-<end> / <subject>` (DayTimeline.tsx);
//  - clicking it opens the dialog named `<title>の操作` (DayDetailModal.tsx) whose danger actions come from
//    dayOccurrenceCancellationPresentation.ts: a one-off plan has exactly one, '予定を削除'; a recurring plan
//    has 'この日だけ削除' / 'この回だけ削除' (+ whole-series '削除'). A series is never deleted here.
// Nothing sleeps: every step waits on a count or visibility.
import { expect } from '@playwright/test';
import { isSavedPlanTitle } from './schedule-plan-title.mjs';

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

// The scheduler can append whole or fractional minutes/hours to the unique title.
// The day view uses that full title for its action dialog. Only the exact title or
// that title plus a duration matches; a neighboring run/task never matches by prefix alone.
const blockTitleOf = text => text.split(' / ')[0];

async function titledBlocks(page, title) {
  const candidates = page.locator(`${SAVED_PLAN_BLOCK}[title^="${attributeValue(title)}"]`);
  const raw = await candidates.evaluateAll(nodes => nodes.map(node => node.getAttribute('title') ?? ''));
  return raw.map((text, index) => ({ index, blockTitle: blockTitleOf(text) })).filter(entry => isSavedPlanTitle(entry.blockTitle, title))
    .map(entry => ({ ...entry, locator: candidates.nth(entry.index) }));
}
const countTitled = async (page, title) => (await titledBlocks(page, title)).length;

async function entryTitles(page, prefix) {
  const raw = await page.locator(SAVED_PLAN_BLOCK).evaluateAll(nodes => nodes.map(node => node.getAttribute('title') ?? ''));
  return [...new Set(raw.map(blockTitleOf).filter(blockTitle => blockTitle.startsWith(prefix)))];
}

/**
 * Deletes every saved one-off plan titled `title` on the open day, proves none remain and returns how many
 * were deleted. `deleteLabels` is the product's accepted label set for a one-off plan; a plan whose danger
 * action is anything else (a recurring series, a changed label) fails loudly instead of deleting.
 */
async function removeVisibleTitled(page, title, deleteLabels) {
  let removed = 0;
  for (let blocks = await titledBlocks(page, title); blocks.length > 0; blocks = await titledBlocks(page, title)) {
    const before = blocks.length;
    await blocks[0].locator.click();
    const menu = page.getByRole('dialog', { name: `${blocks[0].blockTitle}の操作`, exact: true });
    await expect(menu).toBeVisible(WAIT);
    const danger = menu.locator('.schedule-action-item.danger');
    const labels = await danger.locator('strong').allTextContents();
    if (labels.length !== 1 || !deleteLabels.includes(labels[0].trim())) {
      throw new Error(`Refusing to delete: the plan menu offers [${labels.join(', ')}], expected one of [${deleteLabels.join(', ')}] only.`);
    }
    await danger.first().click();
    await expect(menu).toHaveCount(0, WAIT);
    await expect.poll(() => countTitled(page, title), { message: 'deleting must remove exactly one entry', timeout: WAIT.timeout }).toBe(before - 1);
    removed += 1;
  }
  return removed;
}

/** Returns the number of entries removed; a call that finds none fails (cleanup of a saved plan is never vacuous). */
export async function removeSavedPlansByTitle(page, { title, date, deleteLabels = [ONE_OFF_DELETE_LABEL], allowNone = false }) {
  expect(title, 'cleanup needs the exact unique title').toBeTruthy();
  await openScheduleDay(page, date);
  const removed = await removeVisibleTitled(page, title, deleteLabels);
  if (!allowNone) expect(removed, `no saved plan titled "${title}" was found to remove`).toBeGreaterThan(0);
  return removed;
}

/**
 * Removes leftovers of earlier failed runs: every saved plan whose title starts with `titlePrefix`
 * on each of `dates`. Returns the number of leftover entries removed so the caller can report it.
 */
export async function sweepLeftoverPlans(page, { titlePrefix = 'E2E-E2E-VNEXT-', dates, deleteLabels = [ONE_OFF_DELETE_LABEL] }) {
  expect(titlePrefix.length, 'the sweep prefix must be specific').toBeGreaterThanOrEqual(8);
  let removed = 0;
  for (const date of dates) {
    await openScheduleDay(page, date);
    for (const title of await entryTitles(page, titlePrefix)) {
      removed += await removeVisibleTitled(page, title, deleteLabels);
    }
    expect(await entryTitles(page, titlePrefix), `no ${titlePrefix} plan may remain on ${dayLabel(date)}`).toEqual([]);
  }
  return removed;
}

/** Negative self-check for specs: a wrong delete label must fail and must leave the plan in place. */
export async function expectCleanupLabelMismatchFails(page, { title, date }) {
  await openScheduleDay(page, date);
  const before = await countTitled(page, title);
  expect(before, 'the self-check needs a saved plan').toBeGreaterThan(0);
  await expect(removeVisibleTitled(page, title, ['削除'])).rejects.toThrow(/Refusing to delete/u);
  await page.getByRole('dialog').filter({ hasText: title }).getByRole('button', { name: '閉じる', exact: true }).click();
  await expect.poll(() => countTitled(page, title)).toBe(before);
}
