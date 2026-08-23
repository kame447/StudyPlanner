import { expect, test } from '@playwright/test';

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for test-account seeding.`);
  }
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

async function locatorIsVisible(locator) {
  return (await locator.count()) > 0 && (await locator.first().isVisible());
}

async function waitForAuthSurface(page) {
  const accessGateHeading = page.getByRole('heading', { name: '限定公開キー' });
  const loginTab = page.getByRole('tab', { name: 'ログイン', exact: true });

  await expect
    .poll(async () => {
      if (await locatorIsVisible(accessGateHeading)) return 'access-gate';
      if (await locatorIsVisible(loginTab)) return 'auth';
      return 'pending';
    }, { timeout: 20_000 })
    .not.toBe('pending');
}

async function unlockAccessGateIfNeeded(page) {
  const accessGateHeading = page.getByRole('heading', { name: '限定公開キー' });
  if (!(await locatorIsVisible(accessGateHeading))) return;

  if (!liveAccessKey) {
    throw new Error(
      'The production access gate is enabled, but STUDYPLANNER_LIVE_ACCESS_KEY is not configured.',
    );
  }

  await page.getByLabel('閲覧キー').fill(liveAccessKey);
  await page.getByRole('button', { name: 'キーを確認して進む' }).click();
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
}

async function signIn(page) {
  await page.goto('/');

  const primaryNav = page.locator('.primary-bottom-nav');
  if (await locatorIsVisible(primaryNav)) return;

  await waitForAuthSurface(page);
  await unlockAccessGateIfNeeded(page);

  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス').fill(liveEmail);
  await page.getByLabel('パスワード', { exact: true }).fill(livePassword);
  await page.getByRole('button', { name: 'ログインする' }).click();

  const privacyHeading = page.getByRole('heading', { name: '初回利用の確認' });
  const weekStartHeading = page.getByRole('heading', { name: '1週間の始まりを選択' });
  const authError = page.locator('.inline-error, .app-notice.error').first();

  await expect
    .poll(async () => {
      if (await locatorIsVisible(primaryNav)) return 'ready';
      if (await locatorIsVisible(privacyHeading)) return 'privacy-onboarding';
      if (await locatorIsVisible(weekStartHeading)) return 'week-start-onboarding';
      if (await locatorIsVisible(authError)) return 'auth-error';
      return 'pending';
    }, { timeout: 30_000 })
    .not.toBe('pending');

  if (await locatorIsVisible(privacyHeading)) {
    throw new Error('The seed account still requires the initial privacy consent.');
  }
  if (await locatorIsVisible(weekStartHeading)) {
    throw new Error('The seed account still requires the initial week-start preference.');
  }
  if (await locatorIsVisible(authError)) {
    throw new Error('Test-account sign-in failed. Check Environment secrets.');
  }

  await expect(primaryNav).toBeVisible();
}

function primaryNavButton(page, name) {
  return page
    .locator('.primary-bottom-nav')
    .getByRole('button', { name, exact: true });
}

async function ensureBookshelf(page) {
  if (!(await locatorIsVisible(page.locator('.bookshelf-dashboard')))) {
    await primaryNavButton(page, '教材').click();
  }
  await expect(page.locator('.bookshelf-dashboard')).toBeVisible();
}

async function ensureSubject(page, fixture) {
  await ensureBookshelf(page);

  const subjectChip = page
    .locator('.bookshelf-category-chips')
    .getByRole('button', { name: fixture.name, exact: true });
  if (await locatorIsVisible(subjectChip)) return;

  await page.getByLabel('カテゴリを管理').click();
  const manager = page.locator('.bookshelf-manager-modal');
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'カテゴリを追加', exact: true }).click();

  const dialog = page.locator('.bookshelf-modal').filter({
    has: page.getByRole('heading', { name: '教科を追加', exact: true }),
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('教科名', { exact: true }).fill(fixture.name);
  await dialog.getByRole('button', { name: fixture.color, exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(subjectChip).toBeVisible();
}

async function ensureMaterial(page, fixture) {
  await ensureBookshelf(page);

  const subjectChip = page
    .locator('.bookshelf-category-chips')
    .getByRole('button', { name: fixture.subject, exact: true });
  await subjectChip.click();

  const materialRow = page
    .locator('.bookshelf-material-list-row')
    .filter({ hasText: fixture.name });
  if (await locatorIsVisible(materialRow)) return;

  await page.getByRole('button', { name: '教材追加', exact: true }).click();
  const dialog = page.locator('.bookshelf-modal').filter({
    has: page.getByRole('heading', { name: '教材を追加', exact: true }),
  });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('教材名', { exact: true }).fill(fixture.name);
  await dialog.getByLabel('教科', { exact: true }).selectOption({ label: fixture.subject });

  const paceToggle = dialog.locator('.material-pace-toggle input[type="checkbox"]');
  if (!(await paceToggle.isChecked())) await paceToggle.check({ force: true });

  await dialog.getByLabel('単位', { exact: true }).selectOption({ label: fixture.unit });
  await dialog.getByLabel('総量', { exact: true }).fill(String(fixture.total));
  await dialog.getByLabel('現在位置', { exact: true }).fill(String(fixture.current));
  await dialog.getByLabel('目標日', { exact: true }).fill(fixture.targetDate);
  await dialog
    .getByLabel('1単位あたりの目安時間', { exact: true })
    .fill(String(fixture.minutesPerUnit));
  await dialog.getByLabel('1日の最大量', { exact: true }).fill(String(fixture.maxPerDay));

  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('教材を追加しました。', { exact: true })).toBeVisible();

  await subjectChip.click();
  await expect(materialRow).toBeVisible();
}

async function ensureScheduleView(page, viewName) {
  if (!(await locatorIsVisible(page.locator('.schedule-toolbar')))) {
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
  const dateButton = page
    .locator('.schedule-day-strip button')
    .filter({ has: page.locator(`[aria-label^="${dayAriaPrefix(dateString)}"]`) });

  const directButton = page.locator(
    `.schedule-day-strip button[aria-label^="${dayAriaPrefix(dateString)}"]`,
  );
  const target = (await directButton.count()) > 0 ? directButton.first() : dateButton.first();
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

async function ensurePlan(page, fixture) {
  await selectScheduleDate(page, fixture.date);
  if (await locatorIsVisible(page.getByText(fixture.title, { exact: true }))) return;

  const dialog = await openQuickEntry(page);
  await dialog.getByRole('tab', { name: '予定', exact: true }).click();
  await dialog.getByRole('button', { name: '手動入力', exact: true }).click();
  await dialog.getByRole('button', { name: '時間指定', exact: true }).click();

  await dialog
    .locator('.quick-entry-title-field input')
    .fill(fixture.title);
  await dialog
    .getByLabel('教材', { exact: true })
    .selectOption({ label: `${fixture.material}（${fixture.subject}）` });
  await dialog.getByLabel('日付', { exact: true }).fill(fixture.date);
  await dialog.getByLabel('開始時刻', { exact: true }).fill(fixture.startTime);
  await dialog
    .getByRole('button', { name: `${fixture.duration}分`, exact: true })
    .click();
  await dialog.getByLabel('メモ', { exact: true }).fill(fixture.memo);

  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('学習予定を追加しました。', { exact: true })).toBeVisible();
  await selectScheduleDate(page, fixture.date);
  await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
}

async function ensureActual(page, fixture) {
  await selectScheduleDate(page, fixture.date);
  if (await locatorIsVisible(page.getByText(fixture.title, { exact: true }))) return;

  const dialog = await openQuickEntry(page);
  await dialog.getByRole('tab', { name: '記録', exact: true }).click();
  await dialog.locator('.quick-entry-title-field input').fill(fixture.title);
  await dialog.getByLabel('開始時刻', { exact: true }).fill(fixture.startTime);
  await dialog
    .getByRole('button', { name: `${fixture.duration}分`, exact: true })
    .click();
  await dialog
    .getByLabel('教材', { exact: true })
    .selectOption({ label: `${fixture.material}（${fixture.subject}）` });
  await dialog.getByLabel('メモ', { exact: true }).fill(fixture.memo);

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
  const existing = modal
    .locator('.month-event-timeline-item')
    .filter({ hasText: fixture.title });

  if (await locatorIsVisible(existing)) {
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

async function ensureTodo(page, fixture) {
  await ensureScheduleView(page, 'Todo');
  if (await locatorIsVisible(page.getByText(fixture.title, { exact: true }))) return;

  const dialog = await openQuickEntry(page);
  await dialog.getByRole('tab', { name: '予定', exact: true }).click();
  await dialog.getByRole('button', { name: '手動入力', exact: true }).click();
  await dialog.getByRole('button', { name: 'Todo', exact: true }).click();

  await dialog.locator('.quick-entry-title-field input').fill(fixture.title);
  await dialog.getByLabel('教科', { exact: true }).fill(fixture.subject);
  await dialog.getByLabel('締切日', { exact: true }).fill(fixture.dueDate);
  await dialog.getByLabel('締切時刻', { exact: true }).fill(fixture.dueTime);
  await dialog
    .getByRole('button', { name: `${fixture.duration}分`, exact: true })
    .click();
  if (fixture.pinned) {
    const pin = dialog.getByRole('button', { name: 'ピン留め', exact: true });
    if ((await pin.getAttribute('aria-pressed')) !== 'true') await pin.click();
  }
  await dialog.getByLabel('メモ', { exact: true }).fill(fixture.memo);

  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Todoを追加しました。', { exact: true })).toBeVisible();
  await ensureScheduleView(page, 'Todo');
  await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
}

test('seed the dedicated live test account with persistent visual fixtures', async ({ page }) => {
  const today = tokyoTodayIsoDate();

  const subjects = [
    { name: '数学', color: '青' },
    { name: '英語', color: 'オレンジ' },
    { name: '情報科学', color: '紫' },
    { name: '研究', color: '緑' },
  ];

  const materials = [
    {
      name: '青チャート 数学III',
      subject: '数学',
      unit: 'ページ',
      total: 320,
      current: 148,
      targetDate: addDays(today, 45),
      minutesPerUnit: 4,
      maxPerDay: 12,
    },
    {
      name: '1対1対応の演習 数学III',
      subject: '数学',
      unit: '問題',
      total: 180,
      current: 62,
      targetDate: addDays(today, 60),
      minutesPerUnit: 8,
      maxPerDay: 6,
    },
    {
      name: 'DUO 3.0',
      subject: '英語',
      unit: '単語',
      total: 560,
      current: 214,
      targetDate: addDays(today, 30),
      minutesPerUnit: 1,
      maxPerDay: 30,
    },
    {
      name: '英文法ファイナル問題集',
      subject: '英語',
      unit: '問題',
      total: 220,
      current: 170,
      targetDate: addDays(today, 20),
      minutesPerUnit: 3,
      maxPerDay: 20,
    },
    {
      name: 'コンピュータネットワーク 第8版',
      subject: '情報科学',
      unit: 'ページ',
      total: 720,
      current: 205,
      targetDate: addDays(today, 75),
      minutesPerUnit: 5,
      maxPerDay: 16,
    },
    {
      name: 'アルゴリズムイントロダクション',
      subject: '情報科学',
      unit: 'ページ',
      total: 650,
      current: 120,
      targetDate: addDays(today, 90),
      minutesPerUnit: 8,
      maxPerDay: 12,
    },
    {
      name: '卒業研究ノート',
      subject: '研究',
      unit: '章',
      total: 12,
      current: 5,
      targetDate: addDays(today, 40),
      minutesPerUnit: 60,
      maxPerDay: 1,
    },
  ];

  const plans = [
    {
      date: today,
      title: '青チャート 例題演習',
      material: '青チャート 数学III',
      subject: '数学',
      startTime: '08:30',
      duration: 45,
      memo: '例題を中心に、解法の型を確認する。',
    },
    {
      date: today,
      title: 'コンピュータネットワーク 第5章',
      material: 'コンピュータネットワーク 第8版',
      subject: '情報科学',
      startTime: '10:00',
      duration: 60,
      memo: 'トランスポート層を読み、要点をノートにまとめる。',
    },
    {
      date: today,
      title: 'DUO 3.0 復習',
      material: 'DUO 3.0',
      subject: '英語',
      startTime: '13:30',
      duration: 45,
      memo: '前日までの範囲を音読して復習する。',
    },
    {
      date: today,
      title: '卒研 論文整理',
      material: '卒業研究ノート',
      subject: '研究',
      startTime: '20:00',
      duration: 90,
      memo: '関連研究の主張と自分の研究との差分を整理する。',
    },
    {
      date: addDays(today, 1),
      title: '英文法 50問',
      material: '英文法ファイナル問題集',
      subject: '英語',
      startTime: '07:30',
      duration: 30,
      memo: '間違えた問題だけ印を付ける。',
    },
    {
      date: addDays(today, 1),
      title: 'アルゴリズム演習',
      material: 'アルゴリズムイントロダクション',
      subject: '情報科学',
      startTime: '16:00',
      duration: 60,
      memo: '動的計画法の例題を解く。',
    },
    {
      date: addDays(today, 2),
      title: '研究発表スライド修正',
      material: '卒業研究ノート',
      subject: '研究',
      startTime: '18:00',
      duration: 90,
      memo: '背景から結果までの流れを見直す。',
    },
    {
      date: addDays(today, 3),
      title: '数学 演習セット',
      material: '1対1対応の演習 数学III',
      subject: '数学',
      startTime: '19:00',
      duration: 120,
      memo: '微積分の演習をまとめて進める。',
    },
  ];

  const actuals = [
    {
      date: today,
      title: '青チャート 実績',
      material: '青チャート 数学III',
      subject: '数学',
      startTime: '08:35',
      duration: 45,
      memo: '例題6問。予定どおり進めた。',
    },
    {
      date: today,
      title: 'DUO 復習 実績',
      material: 'DUO 3.0',
      subject: '英語',
      startTime: '13:40',
      duration: 30,
      memo: '苦手な例文を重点的に復習した。',
    },
    {
      date: today,
      title: '卒研 実績',
      material: '卒業研究ノート',
      subject: '研究',
      startTime: '20:10',
      duration: 90,
      memo: '関連研究を3本整理した。',
    },
  ];

  const monthEvents = [
    { date: today, title: '研究室ミーティング', allDay: false },
    { date: addDays(today, 1), title: 'レポート提出締切', allDay: true },
    { date: addDays(today, 2), title: 'ゼミ発表', allDay: false },
    { date: addDays(today, 4), title: 'オープンキャンパス', allDay: true },
    { date: addDays(today, 6), title: '健康診断', allDay: false },
  ];

  const todos = [
    {
      title: '研究室に進捗共有',
      subject: '研究',
      dueDate: today,
      dueTime: '23:00',
      duration: 15,
      pinned: true,
      memo: '今日進めた内容を短くまとめて共有する。',
    },
    {
      title: 'ネットワーク課題を提出',
      subject: '情報科学',
      dueDate: addDays(today, 1),
      dueTime: '20:00',
      duration: 60,
      pinned: false,
      memo: '提出前に動作確認とファイル名を確認する。',
    },
    {
      title: 'HCI発表の想定質問を整理',
      subject: '研究',
      dueDate: addDays(today, 2),
      dueTime: '22:00',
      duration: 45,
      pinned: true,
      memo: '反論・限界・今後の応用を中心に準備する。',
    },
    {
      title: '参考文献を3本読む',
      subject: '研究',
      dueDate: addDays(today, 4),
      dueTime: '21:00',
      duration: 90,
      pinned: false,
      memo: '各論文の目的・方法・結果を一行ずつ残す。',
    },
  ];

  await signIn(page);

  for (const subject of subjects) await ensureSubject(page, subject);
  for (const material of materials) await ensureMaterial(page, material);
  for (const plan of plans) await ensurePlan(page, plan);
  for (const actual of actuals) await ensureActual(page, actual);
  for (const event of monthEvents) await ensureMonthEvent(page, event);
  for (const todo of todos) await ensureTodo(page, todo);

  await ensureBookshelf(page);
  for (const subject of subjects) {
    await expect(
      page
        .locator('.bookshelf-category-chips')
        .getByRole('button', { name: subject.name, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByText('青チャート 数学III', { exact: true }).first()).toBeVisible();

  await selectScheduleDate(page, today);
  await expect(page.getByText('青チャート 例題演習', { exact: true })).toBeVisible();
  await expect(page.getByText('青チャート 実績', { exact: true })).toBeVisible();

  await ensureScheduleView(page, '月');
  await expect(page.getByText('研究室ミーティング', { exact: true })).toBeVisible();

  await ensureScheduleView(page, 'Todo');
  await expect(page.getByText('研究室に進捗共有', { exact: true })).toBeVisible();

  await primaryNavButton(page, 'ホーム').click();
  await expect(page.locator('.home-dashboard-default')).toBeVisible();
  await expect(page.getByText('青チャート 例題演習', { exact: true })).toBeVisible();

  console.info('[TestAccountSeed] persistent fixtures verified', {
    date: today,
    subjects: subjects.length,
    materials: materials.length,
    plans: plans.length,
    actuals: actuals.length,
    monthEvents: monthEvents.length,
    todos: todos.length,
  });
});
