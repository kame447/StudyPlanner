import { expect, test } from '@playwright/test';

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for test-account seeding.`);
  return value;
}

const liveEmail = requireSecret('STUDYPLANNER_LIVE_EMAIL');
const livePassword = requireSecret('STUDYPLANNER_LIVE_PASSWORD');
const liveAccessKey = process.env.STUDYPLANNER_LIVE_ACCESS_KEY?.trim() ?? '';

function tokyoTodayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dayAriaPrefix(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return `${year}年 ${month}月${day}日`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldControl(container, caption, selector = 'input, select, textarea') {
  const captionPattern = new RegExp(`^\\s*${escapeRegExp(caption)}`);
  return container
    .locator('label.field')
    .filter({ hasText: captionPattern })
    .locator(selector)
    .first();
}

async function locatorHasVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return true;
  }
  return false;
}

async function waitForAuthSurface(page) {
  const accessGateHeading = page.getByRole('heading', { name: '限定公開キー' });
  const loginTab = page.getByRole('tab', { name: 'ログイン', exact: true });

  await expect
    .poll(async () => {
      if (await locatorHasVisible(accessGateHeading)) return 'access-gate';
      if (await locatorHasVisible(loginTab)) return 'auth';
      return 'pending';
    }, { timeout: 20_000 })
    .not.toBe('pending');
}

async function unlockAccessGateIfNeeded(page) {
  const heading = page.getByRole('heading', { name: '限定公開キー' });
  if (!(await locatorHasVisible(heading))) return;
  if (!liveAccessKey) {
    throw new Error('The production access gate is enabled but its secret is missing.');
  }
  await page.getByLabel('閲覧キー').fill(liveAccessKey);
  await page.getByRole('button', { name: 'キーを確認して進む' }).click();
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
}

async function signIn(page) {
  await page.goto('/');
  const primaryNav = page.locator('.primary-bottom-nav');
  if (await locatorHasVisible(primaryNav)) return;

  await waitForAuthSurface(page);
  await unlockAccessGateIfNeeded(page);
  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス').fill(liveEmail);
  await page.getByLabel('パスワード', { exact: true }).fill(livePassword);
  await page.getByRole('button', { name: 'ログインする' }).click();

  const privacy = page.getByRole('heading', { name: '初回利用の確認' });
  const weekStart = page.getByRole('heading', { name: '1週間の始まりを選択' });
  const authError = page.locator('.inline-error, .app-notice.error');

  await expect
    .poll(async () => {
      if (await locatorHasVisible(primaryNav)) return 'ready';
      if (await locatorHasVisible(privacy)) return 'privacy';
      if (await locatorHasVisible(weekStart)) return 'week-start';
      if (await locatorHasVisible(authError)) return 'auth-error';
      return 'pending';
    }, { timeout: 30_000 })
    .not.toBe('pending');

  if (await locatorHasVisible(privacy)) {
    throw new Error('The seed account still requires initial privacy consent.');
  }
  if (await locatorHasVisible(weekStart)) {
    throw new Error('The seed account still requires a week-start preference.');
  }
  if (await locatorHasVisible(authError)) {
    throw new Error('Test-account sign-in failed. Check Environment secrets.');
  }
  await expect(primaryNav).toBeVisible();
}

function primaryNavButton(page, name) {
  return page.locator('.primary-bottom-nav').getByRole('button', { name, exact: true });
}

async function ensureBookshelf(page) {
  if (!(await locatorHasVisible(page.locator('.bookshelf-dashboard')))) {
    await primaryNavButton(page, '教材').click();
  }
  await expect(page.locator('.bookshelf-dashboard')).toBeVisible();
}

async function ensureSubject(page, fixture) {
  await ensureBookshelf(page);
  const chip = page
    .locator('.bookshelf-category-chips')
    .getByRole('button', { name: fixture.name, exact: true });
  if (await locatorHasVisible(chip)) return;

  await page.getByLabel('カテゴリを管理').click();
  const manager = page.locator('.bookshelf-manager-modal');
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'カテゴリを追加', exact: true }).click();

  const dialog = page.locator('.bookshelf-modal').filter({
    has: page.getByRole('heading', { name: '教科を追加', exact: true }),
  });
  await expect(dialog).toBeVisible();
  await fieldControl(dialog, '教科名', 'input').fill(fixture.name);
  await dialog.getByRole('button', { name: fixture.color, exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(chip).toBeVisible();
}

async function ensureMaterial(page, fixture) {
  await ensureBookshelf(page);
  const chip = page
    .locator('.bookshelf-category-chips')
    .getByRole('button', { name: fixture.subject, exact: true });
  await chip.click();

  const row = page.locator('.bookshelf-material-list-row').filter({ hasText: fixture.name });
  if (await locatorHasVisible(row)) return;

  await page.getByRole('button', { name: '教材追加', exact: true }).click();
  const dialog = page.locator('.bookshelf-modal').filter({
    has: page.getByRole('heading', { name: '教材を追加', exact: true }),
  });
  await expect(dialog).toBeVisible();

  await fieldControl(dialog, '教材名', 'input').fill(fixture.name);
  await fieldControl(dialog, '教科', 'select').selectOption({ label: fixture.subject });

  const paceToggle = dialog.locator('.material-pace-toggle input[type="checkbox"]');
  if (!(await paceToggle.isChecked())) await paceToggle.check({ force: true });

  await fieldControl(dialog, '単位', 'select').selectOption({ label: fixture.unit });
  await fieldControl(dialog, '総量', 'input').fill(String(fixture.total));
  await fieldControl(dialog, '現在位置', 'input').fill(String(fixture.current));
  await fieldControl(dialog, '目標日', 'input').fill(fixture.targetDate);
  await fieldControl(dialog, '1単位あたりの目安時間', 'input').fill(
    String(fixture.minutesPerUnit),
  );
  await fieldControl(dialog, '1日の最大量', 'input').fill(String(fixture.maxPerDay));

  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('教材を追加しました。', { exact: true })).toBeVisible();

  await chip.click();
  await expect(row).toBeVisible();
}

async function ensureScheduleView(page, viewName) {
  if (!(await locatorHasVisible(page.locator('.schedule-toolbar')))) {
    await primaryNavButton(page, '予定').click();
  }
  await expect(page.locator('.schedule-toolbar')).toBeVisible();

  const tab = page
    .locator('.schedule-view-tabs')
    .getByRole('tab', { name: viewName, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function selectScheduleDate(page, dateString) {
  await ensureScheduleView(page, '日');
  const target = page
    .locator(`.schedule-day-strip button[aria-label^="${dayAriaPrefix(dateString)}"]`)
    .first();
  await expect(target).toBeVisible();
  await target.click();
  await expect(target).toHaveAttribute('aria-current', 'date');
}

async function openQuickEntry(page) {
  const trigger = page.locator('.quick-add-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: '学習を追加', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '予定・記録の追加', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function ensureManualPlanInput(dialog) {
  const manualButton = dialog.getByRole('button', { name: '手動入力', exact: true });
  if (await locatorHasVisible(manualButton)) {
    await manualButton.click();
  }
}

async function chooseQuickEntryMode(dialog, modeName) {
  const modeButton = dialog.getByRole('button', { name: modeName, exact: true });
  await expect(modeButton).toBeVisible();
  await modeButton.click();
}

async function ensurePlan(page, fixture) {
  await selectScheduleDate(page, fixture.date);
  if (await locatorHasVisible(page.getByText(fixture.title, { exact: true }))) return;

  const dialog = await openQuickEntry(page);
  await dialog.getByRole('tab', { name: '予定', exact: true }).click();
  await ensureManualPlanInput(dialog);
  await chooseQuickEntryMode(dialog, '時間指定');
  await dialog.locator('.quick-entry-title-field input').fill(fixture.title);
  await fieldControl(dialog, '教材', 'select').selectOption({
    label: `${fixture.material}（${fixture.subject}）`,
  });
  await fieldControl(dialog, '日付', 'input').fill(fixture.date);
  await fieldControl(dialog, '開始時刻', 'input').fill(fixture.startTime);
  await dialog.getByRole('button', { name: `${fixture.duration}分`, exact: true }).click();
  await fieldControl(dialog, 'メモ', 'textarea').fill(fixture.memo);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('学習予定を追加しました。', { exact: true })).toBeVisible();
  await selectScheduleDate(page, fixture.date);
  await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
}

async function ensureActual(page, fixture) {
  await selectScheduleDate(page, fixture.date);
  if (await locatorHasVisible(page.getByText(fixture.title, { exact: true }))) return;

  const dialog = await openQuickEntry(page);
  await dialog.getByRole('tab', { name: '記録', exact: true }).click();
  await dialog.locator('.quick-entry-title-field input').fill(fixture.title);
  await fieldControl(dialog, '開始時刻', 'input').fill(fixture.startTime);
  await dialog.getByRole('button', { name: `${fixture.duration}分`, exact: true }).click();
  await fieldControl(dialog, '教材', 'select').selectOption({
    label: `${fixture.material}（${fixture.subject}）`,
  });
  await fieldControl(dialog, 'メモ', 'textarea').fill(fixture.memo);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('記録を保存しました。', { exact: true })).toBeVisible();
  await selectScheduleDate(page, fixture.date);
  await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
}

async function openMonthEventEditor(page) {
  const trigger = page.locator('.quick-add-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: '予定を追加', exact: true }).click();
  const modal = page.locator('.month-event-modal-overlay');
  await expect(modal).toBeVisible();
  return modal;
}

async function ensureMonthEvent(page, fixture) {
  await selectScheduleDate(page, fixture.date);
  const modal = await openMonthEventEditor(page);
  const existing = modal.locator('.month-event-timeline-item').filter({ hasText: fixture.title });

  if (await locatorHasVisible(existing)) {
    await modal.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(modal).not.toBeVisible();
    return;
  }

  await modal.getByLabel('タイトル', { exact: true }).fill(fixture.title);
  const allDay = modal.locator('.month-event-all-day-switch input[type="checkbox"]');
  if (fixture.allDay && !(await allDay.isChecked())) await allDay.check({ force: true });
  await modal.getByRole('button', { name: '保存', exact: true }).click();

  await expect(modal).not.toBeVisible();
  await expect(page.getByText('月の主要予定を追加しました。', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
}

async function expandTodoSections(page) {
  while (true) {
    const expandButton = page
      .locator('.todo-section-toggle')
      .filter({ hasText: 'すべて表示' })
      .first();
    if (!(await locatorHasVisible(expandButton))) return;
    await expandButton.click();
  }
}

function todoRows(page, title) {
  return page.locator('.todo-view-item').filter({ hasText: title });
}

async function normalizeTodoRows(page, title) {
  await expandTodoSections(page);
  let rows = todoRows(page, title);
  let count = await rows.count();

  while (count > 1) {
    await rows.last().getByRole('button', { name: '削除', exact: true }).click();
    const expectedCount = count - 1;
    await expect
      .poll(async () => todoRows(page, title).count(), { timeout: 10_000 })
      .toBe(expectedCount);
    rows = todoRows(page, title);
    count = expectedCount;
  }

  return count === 1;
}

async function ensureTodo(page, fixture) {
  await ensureScheduleView(page, 'Todo');
  if (await normalizeTodoRows(page, fixture.title)) return;

  const dialog = await openQuickEntry(page);
  await dialog.getByRole('tab', { name: '予定', exact: true }).click();
  await ensureManualPlanInput(dialog);
  await chooseQuickEntryMode(dialog, 'Todo');
  await dialog.locator('.quick-entry-title-field input').fill(fixture.title);
  await fieldControl(dialog, '教科', 'input').fill(fixture.subject);
  await fieldControl(dialog, '締切日', 'input').fill(fixture.dueDate);
  await fieldControl(dialog, '締切時刻', 'input').fill(fixture.dueTime);
  await dialog.getByRole('button', { name: `${fixture.duration}分`, exact: true }).click();

  if (fixture.pinned) {
    const pin = dialog.getByRole('button', { name: 'ピン留め', exact: true });
    if ((await pin.getAttribute('aria-pressed')) !== 'true') await pin.click();
  }

  await fieldControl(dialog, 'メモ', 'textarea').fill(fixture.memo);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Todoを追加しました。', { exact: true })).toBeVisible();
  await ensureScheduleView(page, 'Todo');
  await expandTodoSections(page);
  await expect(todoRows(page, fixture.title).first()).toBeVisible();
  await normalizeTodoRows(page, fixture.title);
}

function buildFixtures(today) {
  const subjects = [
    ['数学', '青'],
    ['英語', 'オレンジ'],
    ['情報科学', '紫'],
    ['研究', '緑'],
  ].map(([name, color]) => ({ name, color }));

  const materials = [
    ['青チャート 数学III', '数学', 'ページ', 320, 148, 45, 4, 12],
    ['1対1対応の演習 数学III', '数学', '問題', 180, 62, 60, 8, 6],
    ['DUO 3.0', '英語', '単語', 560, 214, 30, 1, 30],
    ['英文法ファイナル問題集', '英語', '問題', 220, 170, 20, 3, 20],
    ['コンピュータネットワーク 第8版', '情報科学', 'ページ', 720, 205, 75, 5, 16],
    ['アルゴリズムイントロダクション', '情報科学', 'ページ', 650, 120, 90, 8, 12],
    ['卒業研究ノート', '研究', '章', 12, 5, 40, 60, 1],
  ].map(([name, subject, unit, total, current, targetOffset, minutesPerUnit, maxPerDay]) => ({
    name,
    subject,
    unit,
    total,
    current,
    targetDate: addDays(today, targetOffset),
    minutesPerUnit,
    maxPerDay,
  }));

  const plans = [
    [0, '青チャート 例題演習', '青チャート 数学III', '数学', '08:30', 45, '例題を中心に、解法の型を確認する。'],
    [0, 'コンピュータネットワーク 第5章', 'コンピュータネットワーク 第8版', '情報科学', '10:00', 60, 'トランスポート層を読み、要点をノートにまとめる。'],
    [0, 'DUO 3.0 復習', 'DUO 3.0', '英語', '13:30', 45, '前日までの範囲を音読して復習する。'],
    [0, '卒研 論文整理', '卒業研究ノート', '研究', '20:00', 90, '関連研究の主張と自分の研究との差分を整理する。'],
    [1, '英文法 50問', '英文法ファイナル問題集', '英語', '07:30', 30, '間違えた問題だけ印を付ける。'],
    [1, 'アルゴリズム演習', 'アルゴリズムイントロダクション', '情報科学', '16:00', 60, '動的計画法の例題を解く。'],
    [2, '研究発表スライド修正', '卒業研究ノート', '研究', '18:00', 90, '背景から結果までの流れを見直す。'],
    [3, '数学 演習セット', '1対1対応の演習 数学III', '数学', '19:00', 120, '微積分の演習をまとめて進める。'],
  ].map(([offset, title, material, subject, startTime, duration, memo]) => ({
    date: addDays(today, offset),
    title,
    material,
    subject,
    startTime,
    duration,
    memo,
  }));

  const actuals = [
    ['青チャート 実績', '青チャート 数学III', '数学', '08:35', 45, '例題6問。予定どおり進めた。'],
    ['DUO 復習 実績', 'DUO 3.0', '英語', '13:40', 30, '苦手な例文を重点的に復習した。'],
    ['卒研 実績', '卒業研究ノート', '研究', '20:10', 90, '関連研究を3本整理した。'],
  ].map(([title, material, subject, startTime, duration, memo]) => ({
    date: today,
    title,
    material,
    subject,
    startTime,
    duration,
    memo,
  }));

  const monthEvents = [
    [0, '研究室ミーティング', false],
    [1, 'レポート提出締切', true],
    [2, 'ゼミ発表', false],
    [4, 'オープンキャンパス', true],
    [6, '健康診断', false],
  ].map(([offset, title, allDay]) => ({ date: addDays(today, offset), title, allDay }));

  const todos = [
    ['研究室に進捗共有', '研究', 0, '23:00', 15, true, '今日進めた内容を短くまとめて共有する。'],
    ['ネットワーク課題を提出', '情報科学', 1, '20:00', 60, false, '提出前に動作確認とファイル名を確認する。'],
    ['HCI発表の想定質問を整理', '研究', 2, '22:00', 45, true, '反論・限界・今後の応用を中心に準備する。'],
    ['参考文献を3本読む', '研究', 4, '21:00', 90, false, '各論文の目的・方法・結果を一行ずつ残す。'],
  ].map(([title, subject, offset, dueTime, duration, pinned, memo]) => ({
    title,
    subject,
    dueDate: addDays(today, offset),
    dueTime,
    duration,
    pinned,
    memo,
  }));

  return { subjects, materials, plans, actuals, monthEvents, todos };
}

test('seed the dedicated live test account with persistent visual fixtures', async ({ page }) => {
  const today = tokyoTodayIsoDate();
  const fixtures = buildFixtures(today);

  await signIn(page);

  for (const subject of fixtures.subjects) await ensureSubject(page, subject);
  for (const material of fixtures.materials) await ensureMaterial(page, material);
  for (const plan of fixtures.plans) await ensurePlan(page, plan);
  for (const actual of fixtures.actuals) await ensureActual(page, actual);
  for (const event of fixtures.monthEvents) await ensureMonthEvent(page, event);
  for (const todo of fixtures.todos) await ensureTodo(page, todo);

  await ensureBookshelf(page);
  const mathChip = page
    .locator('.bookshelf-category-chips')
    .getByRole('button', { name: '数学', exact: true });
  await mathChip.click();
  await expect(
    page.locator('.bookshelf-material-list-row').filter({ hasText: '青チャート 数学III' }),
  ).toBeVisible();

  await selectScheduleDate(page, today);
  await expect(page.getByText('青チャート 例題演習', { exact: true })).toBeVisible();
  await expect(page.getByText('青チャート 実績', { exact: true })).toBeVisible();

  await ensureScheduleView(page, '月');
  await expect(page.getByText('研究室ミーティング', { exact: true })).toBeVisible();

  await ensureScheduleView(page, 'Todo');
  await expandTodoSections(page);
  await expect(todoRows(page, '研究室に進捗共有')).toHaveCount(1);
  await expect(todoRows(page, '研究室に進捗共有').first()).toBeVisible();

  await primaryNavButton(page, 'ホーム').click();
  await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();

  console.info('[TestAccountSeed] persistent fixtures verified', {
    date: today,
    subjects: fixtures.subjects.length,
    materials: fixtures.materials.length,
    plans: fixtures.plans.length,
    actuals: fixtures.actuals.length,
    monthEvents: fixtures.monthEvents.length,
    todos: fixtures.todos.length,
  });
});
