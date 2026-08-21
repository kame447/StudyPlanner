import { expect, test } from '@playwright/test';

async function seedThemeUser(page, { mode = 'dark', palette = 'ocean' } = {}) {
  await page.addInitScript(({ mode, palette }) => {
    const now = new Date().toISOString();
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

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
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

function expectDarkSurface(color) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  expect(channels).toHaveLength(3);
  expect(Math.max(...channels)).toBeLessThan(100);
}

async function clickPrimaryNav(page, label) {
  const nav = page.locator('.home-bottom-nav:visible').last();
  await nav.locator('button').filter({ hasText: label }).click();
}

test('dark mode and accent palette stay consistent across primary surfaces', async ({ page }) => {
  await seedThemeUser(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const accent = await normalizedAccent(page);

  await expect(page.locator('.home-dashboard')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.home-streak-card', 'backgroundColor'));
  expect(await computedColor(page, '.home-bottom-nav button.active')).toBe(accent);

  await clickPrimaryNav(page, '教材');
  await expect(page.locator('.bookshelf-view')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.bookshelf-subject-list', 'backgroundColor'));
  expect(await computedColor(page, '.bookshelf-bottom-nav button.active')).toBe(accent);

  await clickPrimaryNav(page, '予定');
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.schedule-view-tabs', 'backgroundColor'));
  expect(await computedColor(page, '.schedule-view-tabs button.active', 'backgroundColor')).toBe(accent);

  await clickPrimaryNav(page, 'AI計画');
  await expect(page.locator('.ai-planning-card')).toBeVisible();
  expectDarkSurface(await computedColor(page, '.ai-planning-card', 'backgroundColor'));
  expect(await computedColor(page, '.ai-planning-send-button', 'backgroundColor')).toBe(accent);

  await clickPrimaryNav(page, '分析');
  await expect(page.locator('.report-view')).toBeVisible();
  const reportPanel = page.locator('.report-view .panel').first();
  await expect(reportPanel).toBeVisible();
  expectDarkSurface(await reportPanel.evaluate((element) => getComputedStyle(element).backgroundColor));
});

test('theme mode and palette changes apply immediately and survive reload', async ({ page }) => {
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

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.home-dashboard')).toBeVisible();
  expect(await normalizedAccent(page)).toBe(violetAccent);
  expect(await computedColor(page, '.home-bottom-nav button.active')).toBe(violetAccent);
});
