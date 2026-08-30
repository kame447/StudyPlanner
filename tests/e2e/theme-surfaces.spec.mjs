import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const reviewDir = path.resolve(process.cwd(), 'artifacts', 'theme-visual-review');

async function seedThemeUser(page, { mode = 'dark', palette = 'ocean' } = {}) {
  await page.addInitScript(({ mode, palette }) => {
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const today = [
      nowDate.getFullYear(),
      String(nowDate.getMonth() + 1).padStart(2, '0'),
      String(nowDate.getDate()).padStart(2, '0'),
    ].join('-');
    const user = {
      id: 'theme-surface-user',
      email: 'theme-surface@example.com',
      username: 'theme-surface-user',
      avatar: '',
      createdAt: now,
    };
    const subject = {
      id: 'theme-surface-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'theme-surface-material',
      userId: user.id,
      name: 'テーマ確認教材',
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      status: 'active',
      progressUnit: 'page',
      totalUnits: 100,
      currentUnit: 40,
      createdAt: now,
      updatedAt: now,
    };
    const plan = {
      id: 'theme-surface-plan',
      seriesId: 'theme-surface-plan',
      userId: user.id,
      title: 'テーマ確認予定',
      subject: subject.name,
      type: 'study',
      date: today,
      startTime: '09:00',
      endTime: '10:00',
      memo: '',
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));

    if (!localStorage.getItem('study-planner-theme-mode')) {
      localStorage.setItem('study-planner-theme-mode', mode);
    }
    if (!localStorage.getItem('study-planner-theme-palette')) {
      localStorage.setItem('study-planner-theme-palette', palette);
    }
  }, { mode, palette });
}

async function normalizedAccent(page) {
  return page.evaluate(() => {
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim();
    const probe = document.createElement('span');
    probe.style.color = accent;
    document.body.append(probe);
    const normalized = getComputedStyle(probe).color;
    probe.remove();
    return normalized;
  });
}

async function computedColor(page, selector, property = 'color') {
  return page.locator(selector).first().evaluate((element, propertyName) => (
    getComputedStyle(element)[propertyName]
  ), property);
}

function parseRgb(color) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Unsupported color: ${color}`);
  }
  return channels;
}

function relativeLuminance(color) {
  const channels = parseRgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function expectDarkSurface(color) {
  const channels = parseRgb(color);
  expect(Math.max(...channels)).toBeLessThan(100);
}

async function clickPrimaryNav(page, label) {
  const nav = page.locator('.home-bottom-nav:visible').last();
  await nav.locator('button').filter({ hasText: label }).click();
}

async function capture(page, name) {
  fs.mkdirSync(reviewDir, { recursive: true });
  await page.screenshot({
    path: path.join(reviewDir, `${name}.png`),
    fullPage: false,
  });
}

test('dark mode and accent palette stay consistent across primary surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedThemeUser(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const accent = await normalizedAccent(page);

  await expect(page.locator('.home-main > .home-dashboard')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.home-streak-card', 'backgroundColor'));
  expect(await computedColor(page, '.home-bottom-nav button.active')).toBe(accent);
  expect(await computedColor(page, '.home-date-paper', 'backgroundImage')).toContain(
    'repeating-linear-gradient',
  );
  expect(await computedColor(page, '.home-date-value')).toBe('rgb(255, 250, 240)');
  await capture(page, 'dark-ocean-home-390x844');

  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await expect(page.getByRole('heading', { name: 'アプリ設定' })).toBeVisible();
  await capture(page, 'dark-ocean-settings-390x844');
  await page.locator('.app-settings-modal .ghost-button').first().click();

  await clickPrimaryNav(page, '教材');
  await expect(page.locator('.bookshelf-view')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.bookshelf-dashboard', 'backgroundColor'));
  expect(await computedColor(page, '.bookshelf-bottom-nav button.active')).toBe(accent);
  await capture(page, 'dark-ocean-bookshelf-390x844');

  await clickPrimaryNav(page, '予定');
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.schedule-view-tabs', 'backgroundColor'));
  expect(await computedColor(page, '.schedule-view-tabs button.active', 'backgroundColor')).toBe(accent);

  await page.locator('.schedule-view-tabs button').filter({ hasText: '週' }).click();
  await expect(page.locator('.schedule-week-view')).toBeVisible();
  const scheduleBlock = page.locator('.schedule-week-block').first();
  await expect(scheduleBlock).toBeVisible();
  const scheduleBlockColors = await scheduleBlock.evaluate((element) => {
    const title = element.querySelector('strong');
    const time = element.querySelector('small');
    if (!(title instanceof HTMLElement) || !(time instanceof HTMLElement)) {
      throw new Error('Schedule block text is missing');
    }
    return {
      background: getComputedStyle(element).backgroundColor,
      title: getComputedStyle(title).color,
      time: getComputedStyle(time).color,
    };
  });
  expect(relativeLuminance(scheduleBlockColors.background)).toBeGreaterThan(0.75);
  expect(contrastRatio(scheduleBlockColors.title, scheduleBlockColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(scheduleBlockColors.time, scheduleBlockColors.background)).toBeGreaterThanOrEqual(4.5);
  await capture(page, 'dark-ocean-schedule-week-390x844');

  await clickPrimaryNav(page, 'AI計画');
  await expect(page.locator('.ai-planning-card')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.ai-planning-card', 'backgroundColor'));
  expect(await computedColor(page, '.ai-planning-send-button', 'backgroundColor')).toBe(accent);
  await capture(page, 'dark-ocean-ai-planning-390x844');

  await clickPrimaryNav(page, 'ホーム');
  await expect(page.locator('.home-main > .home-dashboard')).toBeVisible();
  await page.getByRole('button', { name: /詳細を見る/ }).click();
  await expect(page.locator('.learning-report-view')).toBeVisible();
  const reportSummaryCard = page.locator('.learning-report-summary-card').first();
  await expect(reportSummaryCard).toBeVisible();
  expectDarkSurface(
    await reportSummaryCard.evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  await capture(page, 'dark-ocean-report-390x844');
});

test('theme mode and palette changes apply immediately and survive reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedThemeUser(page);
  await page.goto('/');
  await expect(page.locator('.home-streak-card')).toBeVisible();

  const darkBackground = await computedColor(page, '.home-streak-card', 'backgroundColor');
  expectDarkSurface(darkBackground);

  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await expect(page.getByRole('heading', { name: 'アプリ設定' })).toBeVisible();
  await page.getByRole('button', { name: 'ライト', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.app-settings-modal .ghost-button').first().click();

  const lightBackground = await computedColor(page, '.home-streak-card', 'backgroundColor');
  expect(lightBackground).not.toBe(darkBackground);

  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await page.getByRole('button', { name: /配色/ }).click();
  await page.getByRole('button', { name: /バイオレット/ }).click();
  const violetAccent = await normalizedAccent(page);
  await page.locator('.app-settings-modal .ghost-button').first().click();

  expect(await computedColor(page, '.home-bottom-nav button.active')).toBe(violetAccent);
  await capture(page, 'light-violet-home-390x844');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.home-main > .home-dashboard')).toBeVisible();
  expect(await normalizedAccent(page)).toBe(violetAccent);
  expect(await computedColor(page, '.home-bottom-nav button.active')).toBe(violetAccent);

  await clickPrimaryNav(page, '教材');
  await expect(page.locator('.bookshelf-view')).toBeVisible();
  expect(await computedColor(page, '.bookshelf-bottom-nav button.active')).toBe(violetAccent);
  await capture(page, 'light-violet-bookshelf-390x844');
});
