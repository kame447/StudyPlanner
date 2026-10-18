import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/startup-ready.mjs';
import { clickPrimaryNav, seedRegressionUser } from './support/ui-regression.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const srcRoot = path.join(repoRoot, 'src');
const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html?gate=real-weekly';
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
  const released = await page.evaluate(() => window.__realWeeklyRuntime.release());
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
  // User-opened disclosures may focus non-text controls. Keep these statement-specific
  // so new text-control or unrestricted focus in the same file still fails this guard.
  // Browser tests assert the actual heading/tab/button or checked native radio.
  const allowedFocusStatements = new Map([
    // Selecting a catalog result may hand its focus to the non-text summary.
    // A later user focus change cancels that request; material browser cases
    // assert both the summary handoff and preservation of a newer input focus.
    ['src/components/BookshelfMaterialDialog.tsx', new Set([
      'if (catalogFocusRequest > 0) catalogSummaryRef.current?.focus();',
    ])],
    // Only the checked native radio in the user-opened label picker may receive focus.
    // It cannot summon a text keyboard; color cases assert arrows and focus restoration.
    ['src/components/MonthEventColorPicker.tsx', new Set([
      "if (selectedRadio?.type === 'radio' && selectedRadio.checked) selectedRadio.focus();",
    ])],
    // Auth Arrow/Home/End navigation focuses only an explicitly selected mode button.
    ['src/components/AuthScreen.tsx', new Set([
      'event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-intent="${nextIntent}"]`)?.focus();',
    ])],
    // Arrow/Home/End navigation focuses only the sibling mode buttons.
    ['src/components/StudySessionModePicker.tsx', new Set([
      'event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();',
    ])],
    // User-opened settings focus their h1; Save/Back restore the launch button.
    // Neither target is a text control; Pomodoro browser tests assert both.
    ['src/components/StudySessionView.tsx', new Set([
      "if (phase === 'settings') headingRef.current?.focus();",
      'settingsButtonRef.current?.focus();',
    ])],
    ['src/components/home/TodayScheduleAddMenu.tsx', new Set([
      'firstActionRef.current?.focus({ preventScroll: true });',
      'toggleRef.current?.focus({ preventScroll: true });',
      // The selected HTMLButtonElement becomes the dialog's non-input return target.
      'button.focus({ preventScroll: true });',
    ])],
    ['src/components/AppSettingsDialog.tsx', new Set([
      'titleRef.current?.focus({ preventScroll: true });',
      'tabRefs.current[TABS[next].id]?.focus();',
    ])],
    ['src/components/HomeTopbar.tsx', new Set([
      'event.currentTarget.focus({ preventScroll: true });',
    ])],
    // User-opened announcements focus only their button opener and Back button.
    // The dedicated announcement browser cases assert both, including detail/history.
    ['src/components/AnnouncementsButton.tsx', new Set([
      'event.currentTarget.focus({ preventScroll: true });',
      'back.current?.focus({ preventScroll: true });',
    ])],
    ['src/components/AnnouncementsPage.tsx', new Set([
      "dialog.current?.querySelector<HTMLButtonElement>('.announcements-back')?.focus({ preventScroll: true });",
    ])],
    ['src/hooks/useSettingsNavigation.ts', new Set([
      'if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });',
    ])],
    // Public navigation initially focuses only its non-input return link.
    // Back restores the user's previous focus only when that origin is visible;
    // it does not choose a new input or restore focus to a hidden planner.
    ['src/components/PublicPageBoundary.tsx', new Set([
      "publicSurface.current?.querySelector<HTMLElement>('.legal-back-link')?.focus({ preventScroll: true });",
      'if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });',
    ])],
    // The user-opened calendar focuses its h1 and restores its launch button.
    // Dedicated calendar browser cases assert both targets and the 16px date input.
    ['src/components/StudyStreakView.tsx', new Set([
      'titleRef.current?.focus({ preventScroll: true });',
    ])],
    ['src/hooks/useStudyStreakNavigation.ts', new Set([
      'if (origin.current.element?.isConnected) origin.current.element.focus({ preventScroll: true });',
    ])],
    // A keyboard promotion disables the focused promote button; focus moves to the
    // preview dialog sheet itself (not Save, not a text control). The weekly preview
    // browser case asserts the dialog keeps focus and further Enter/Space are inert.
    ['src/components/AiPlanningPreviewDialog.tsx', new Set([
      'dialogRef.current?.focus({ preventScroll: true });',
    ])],
  ]);
  const hasUnexpectedFocus = (fileName, line) => line.includes('.focus(')
    && !allowedFocusFiles.has(fileName) && !allowedFocusStatements.get(fileName)?.has(line.trim());

  // The radio exception must not permit text inputs, unchecked radios or generic focus.
  for (const statement of [
    'selectedInputRef.current?.focus();',
    'selectedRadio.focus();',
    "if (selectedRadio?.type === 'text' && selectedRadio.checked) selectedRadio.focus();",
    "if (selectedRadio?.type === 'radio') selectedRadio.focus();",
  ]) expect(hasUnexpectedFocus('src/components/MonthEventColorPicker.tsx', statement)).toBe(true);

  // This exception permits neither an initial/unconditional focus nor text controls.
  const materialDialogFile = 'src/components/BookshelfMaterialDialog.tsx';
  for (const statement of [
    'catalogSummaryRef.current?.focus();',
    'if (catalogFocusRequest >= 0) catalogSummaryRef.current?.focus();',
    'if (catalogFocusRequest > 0) nameInputRef.current?.focus();',
    'if (catalogFocusRequest > 0) selectedInputRef.current?.focus();',
  ]) expect(hasUnexpectedFocus(materialDialogFile, statement)).toBe(true);
  const materialDialogSource = fs.readFileSync(path.join(repoRoot, materialDialogFile), 'utf8');
  expect(materialDialogSource).toMatch(/<summary\b[^>]*\bref=\{catalogSummaryRef\}/);
  expect(materialDialogSource.match(/\bref=\{catalogSummaryRef\}/g)).toHaveLength(1);

  // The preview exception permits only the dialog sheet, never its inputs or Save.
  const previewDialogFile = 'src/components/AiPlanningPreviewDialog.tsx';
  for (const statement of [
    'dialogRef.current?.focus();',
    'saveRef.current?.focus({ preventScroll: true });',
    'inputRef.current?.focus({ preventScroll: true });',
  ]) expect(hasUnexpectedFocus(previewDialogFile, statement)).toBe(true);
  const previewDialogSource = fs.readFileSync(path.join(repoRoot, previewDialogFile), 'utf8');
  expect(previewDialogSource.match(/\bref=\{dialogRef\}/g)).toHaveLength(1);
  expect(previewDialogSource).toMatch(/ref=\{dialogRef\}\s+tabIndex=\{-1\}[\s\S]{0,200}role="dialog"/);

  // Delivery failure focuses only its explicit, non-input Back button.
  // Keep the exception tied to that unique button ref, not an entire file.
  const announcementButtonFile = 'src/components/AnnouncementsButton.tsx';
  for (const statement of [
    'inputRef.current?.focus({ preventScroll: true });',
    'textareaRef.current?.focus({ preventScroll: true });',
    'back.current?.focus();',
    'dialog.current?.focus({ preventScroll: true });',
  ]) expect(hasUnexpectedFocus(announcementButtonFile, statement)).toBe(true);
  const announcementButtonSource = fs.readFileSync(path.join(repoRoot, announcementButtonFile), 'utf8');
  expect(announcementButtonSource).toContain('const back = useRef<HTMLButtonElement>(null);');
  expect(announcementButtonSource).toMatch(/<button\b[^>]*\bref=\{back\}[^>]*\btype="button"/);
  expect(announcementButtonSource.match(/\bref=\{back\}/g)).toHaveLength(1);

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const fileName = relative(file);

    if (/\bautoFocus\b|\bautofocus\b/.test(source)) autofocus.push(fileName);
    if (/contentEditable\s*=/.test(source)) contentEditableInputs.push(fileName);

    source.split('\n').forEach((line, index) => {
      if (hasUnexpectedFocus(fileName, line)) {
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
    await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();

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
    await page.goto(REAL_WEEKLY_URL);
    let input = page.locator('.ai-planning-composer textarea');
    await expect(input).toBeVisible();
    await expect(input).not.toBeFocused();
    await expectVisibleTextControlsAtLeast16px(page);

    await input.fill('来週の予定');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__realWeeklyRuntime.pending())).toBe(1);
    await page.getByRole('button', { name: '処理をキャンセル' }).click();
    await releaseWeeklyGate(page);
    await expect.poll(() => page.evaluate(() => window.__realWeeklyEvents.filter((event) => event.type === 'real-runtime-complete').length)).toBe(1);
    await expect(page.locator('.ai-planning-conversation').getByText('テスト応答: 来週の予定', { exact: true })).toHaveCount(0);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

    input = page.locator('.ai-planning-composer textarea');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(input).not.toBeFocused();
    await input.click();
    await expect(input).toBeFocused();
  });
});
