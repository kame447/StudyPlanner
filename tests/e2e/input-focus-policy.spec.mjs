import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { clickPrimaryNav, seedRegressionUser } from './support/ui-regression.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const srcRoot = path.join(repoRoot, 'src');
const WEEKLY_HARNESS_URL = 'http://127.0.0.1:4174/?weekly=1';
const AUTH_HARNESS_URL = 'http://127.0.0.1:4174/?scenario=auth';
const TEXT_CONTROL_SELECTOR = [
  'textarea',
  'select',
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"])',
].join(',');

function productionSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(absolute);
    if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\./.test(entry.name)) return [];
    return [absolute];
  });
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

async function focusedElement(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    return {
      tagName: element.tagName.toLowerCase(),
      type: element instanceof HTMLInputElement ? element.type : null,
      className: element.className,
      ariaLabel: element.getAttribute('aria-label'),
    };
  });
}

async function expectNoTextControlFocused(page) {
  const active = await focusedElement(page);
  expect(['input', 'textarea', 'select']).not.toContain(active?.tagName ?? '');
}

async function visibleTextControlStyles(page, rootSelector = 'body') {
  return page.evaluate(({ selector, controlSelector }) => {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`missing root: ${selector}`);

    return [...root.querySelectorAll(controlSelector)]
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      })
      .map((element) => ({
        tagName: element.tagName.toLowerCase(),
        type: element instanceof HTMLInputElement ? element.type : null,
        ariaLabel: element.getAttribute('aria-label'),
        placeholder: element.getAttribute('placeholder'),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      }));
  }, { selector: rootSelector, controlSelector: TEXT_CONTROL_SELECTOR });
}

async function expectVisibleTextControlsAtLeast16px(page, rootSelector = 'body') {
  const controls = await visibleTextControlStyles(page, rootSelector);
  expect(controls.length).toBeGreaterThan(0);
  const undersized = controls.filter((control) => control.fontSize < 16);
  expect(undersized).toEqual([]);
}

async function releaseWeeklyGate(page) {
  const released = await page.evaluate(() => window.__quickEntryHarness.release('weekly'));
  expect(released).toBe(true);
}

test('production source has no input auto-focus escape hatch or viewport zoom lock', () => {
  const files = productionSourceFiles(srcRoot);
  const autofocus = [];
  const unexpectedFocus = [];
  const contentEditableInputs = [];
  const allowedFocusFiles = new Set([
    'src/hooks/useDialogFocus.ts',
    'src/components/MonthView.tsx',
    'src/components/QuickAddMenu.tsx',
  ]);

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const fileName = relative(file);

    if (/\bautoFocus\b|\bautofocus\b/.test(source)) autofocus.push(fileName);
    if (/contentEditable\s*=/.test(source)) contentEditableInputs.push(fileName);

    source.split('\n').forEach((line, index) => {
      if (line.includes('.focus(') && !allowedFocusFiles.has(fileName)) {
        unexpectedFocus.push(`${fileName}:${index + 1}:${line.trim()}`);
      }
    });
  }

  const zoomLockFiles = [path.join(repoRoot, 'index.html'), ...files]
    .filter((file) => fs.existsSync(file))
    .filter((file) => /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0+)?\b/i.test(fs.readFileSync(file, 'utf8')))
    .map(relative);

  expect(autofocus).toEqual([]);
  expect(unexpectedFocus).toEqual([]);
  expect(contentEditableInputs).toEqual([]);
  expect(zoomLockFiles).toEqual([]);
});

test.describe('mobile browser input focus policy', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('auth surface opens without stealing focus and keeps all visible text controls zoom-safe', async ({ page }) => {
    await page.goto(AUTH_HARNESS_URL);
    await expect(page.getByRole('heading', { name: '新規会員登録' })).toBeVisible();

    await expectNoTextControlFocused(page);
    await expectVisibleTextControlsAtLeast16px(page);

    const email = page.getByLabel('メールアドレス');
    await email.click();
    await expect(email).toBeFocused();
    await expectVisibleTextControlsAtLeast16px(page);
  });

  test('full app navigation does not auto-focus AI, bookshelf, schedule, or timetable inputs', async ({ page }) => {
    await seedRegressionUser(page);
    await page.goto('/');
    await expect(page.locator('.primary-bottom-nav')).toBeVisible();

    await clickPrimaryNav(page, 'AI計画');
    const composer = page.locator('.ai-planning-composer textarea');
    await expect(composer).toBeVisible();
    await expect(composer).not.toBeFocused();
    await expectVisibleTextControlsAtLeast16px(page, '.ai-planning-card');

    const starter = page.locator('.ai-planning-starter-list button').first();
    if (await starter.isVisible()) {
      await starter.click();
      await expect(composer).not.toBeFocused();
    }

    await clickPrimaryNav(page, '教材');
    await page.getByRole('button', { name: '教材を検索' }).click();
    const bookshelfSearch = page.getByPlaceholder('教材名・カテゴリで検索');
    await expect(bookshelfSearch).toBeVisible();
    await expect(bookshelfSearch).not.toBeFocused();
    await expectVisibleTextControlsAtLeast16px(page, '.bookshelf-view');
    await bookshelfSearch.click();
    await expect(bookshelfSearch).toBeFocused();

    await clickPrimaryNav(page, '予定');
    const trigger = page.locator('.quick-add-trigger');
    await trigger.click();
    await page.getByRole('menuitem', { name: '予定を追加' }).click();
    await expect(page.locator('.month-event-modal-overlay')).toBeVisible();
    await expectNoTextControlFocused(page);
    await expectVisibleTextControlsAtLeast16px(page, '.month-event-modal-overlay');

    await page.getByRole('button', { name: '閉じる' }).click();
    await clickPrimaryNav(page, '時間割');
    const firstPeriodStart = page.locator('input[aria-label="1限 開始時刻"]');
    await expect(firstPeriodStart).toBeVisible();
    await expect(firstPeriodStart).not.toBeFocused();
    await expectVisibleTextControlsAtLeast16px(page, '.timetable-view');
    await firstPeriodStart.click();
    await expect(firstPeriodStart).toBeFocused();
  });

  test('weekly cancellation leaves the composer unfocused while preserving direct user focus', async ({ page }) => {
    await page.goto(`${WEEKLY_HARNESS_URL}&gate=weekly`);
    let input = page.getByLabel('週間計画にしたいこと');
    await expect(input).toBeVisible();
    await expect(input).not.toBeFocused();
    await expectVisibleTextControlsAtLeast16px(page);

    await input.fill('来週の予定');
    await input.press('Control+Enter');
    await page.getByRole('button', { name: '処理をキャンセル' }).click();
    await releaseWeeklyGate(page);
    await expect.poll(() => page.evaluate(() => window.__quickEntryEvents.filter((event) => event.type === 'ignore-weekly-turn').length)).toBe(1);

    input = page.getByLabel('週間計画にしたいこと');
    await expect(input).toBeVisible();
    await expect(input).not.toBeFocused();
    await input.click();
    await expect(input).toBeFocused();
  });
});
