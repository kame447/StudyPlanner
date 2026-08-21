import { expect, test } from '@playwright/test';

async function seedBookshelf(page) {
  await page.addInitScript(() => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrowDate = new Date(`${today}T00:00:00`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = [
      tomorrowDate.getFullYear(),
      String(tomorrowDate.getMonth() + 1).padStart(2, '0'),
      String(tomorrowDate.getDate()).padStart(2, '0'),
    ].join('-');
    const now = new Date().toISOString();
    const user = {
      id: 'bookshelf-e2e-user',
      email: 'bookshelf-e2e@example.com',
      username: 'bookshelf-e2e',
      avatar: '',
      createdAt: now,
    };
    const subject = {
      id: 'bookshelf-e2e-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'bookshelf-e2e-material',
      userId: user.id,
      name: 'アルゴリズム問題集',
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      status: 'active',
      paceEnabled: true,
      progressUnit: 'page',
      totalUnits: 200,
      currentUnit: 80,
      targetDate: tomorrow,
      createdAt: now,
      updatedAt: now,
    };
    const secondMaterial = {
      ...material,
      id: 'bookshelf-e2e-material-2',
      name: 'ネットワーク演習',
      currentUnit: 30,
    };
    const plan = {
      id: 'bookshelf-e2e-plan',
      seriesId: 'bookshelf-e2e-plan',
      userId: user.id,
      title: 'アルゴリズム問題集を進める',
      subject: subject.name,
      date: tomorrow,
      startTime: '19:00',
      endTime: '20:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: 'study',
      memo: '',
      sourceType: 'manual',
      materialId: material.id,
      materialName: material.name,
      createdAt: now,
      updatedAt: now,
    };
    const actual = {
      id: 'bookshelf-e2e-actual',
      userId: user.id,
      planId: null,
      occurrenceDate: today,
      actualStartTime: '18:00',
      actualEndTime: '18:45',
      title: 'アルゴリズム演習',
      subject: subject.name,
      isAlignedToPlan: false,
      note: '動的計画法を復習',
      updatedAt: now,
      materialId: material.id,
      materialName: material.name,
      materialProgressUpdates: [
        {
          materialId: material.id,
          progressUnit: 'page',
          progressUnitLabel: 'ページ',
          fromUnit: 60,
          toUnit: 80,
          deltaUnits: 20,
        },
      ],
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', JSON.stringify([actual]));
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem(
      'studyplanner.studyMaterials.v1',
      JSON.stringify([material, secondMaterial]),
    );
    localStorage.setItem(
      `studyplanner:material-detail:v1:${user.id}:${material.id}`,
      JSON.stringify({
        structureEnabled: true,
        structureVisible: true,
        favorite: true,
        structureItems: [
          { id: 'structure-1', title: '基礎編', startUnit: 0, endUnit: 100 },
          { id: 'structure-2', title: '応用編', startUnit: 100, endUnit: 200 },
        ],
      }),
    );
  });
}

async function openBookshelf(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '教材' })
    .click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
}

test('opens the redesigned bookshelf and material detail from the main navigation', async ({ page }) => {
  await seedBookshelf(page);
  await openBookshelf(page);

  await expect(page.locator('.primary-app-header')).toBeVisible();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await expect(page.locator('.app-view-switcher')).toBeHidden();
  await expect(page.getByRole('heading', { name: '教材', exact: true })).toBeVisible();
  await expect(page.getByText('よく使う教材')).toBeVisible();
  await expect(page.getByText('アルゴリズム問題集').first()).toBeVisible();

  const headerOverflow = await page.locator('.primary-app-header .home-topbar').evaluate((header) => ({
    scrollWidth: header.scrollWidth,
    clientWidth: header.clientWidth,
  }));
  expect(headerOverflow.scrollWidth).toBeLessThanOrEqual(headerOverflow.clientWidth + 1);

  await page.getByText('アルゴリズム問題集').first().click();

  await expect(page.getByRole('heading', { name: '教材の詳細' })).toBeVisible();
  await expect(page.getByText('進捗 40%')).toBeVisible();
  await expect(page.getByText('基礎編', { exact: true })).toBeVisible();
  await expect(page.getByText('45分')).toBeVisible();

  await page.getByRole('button', { name: '学習記録', exact: true }).click();
  await expect(page.getByText('60 → 80ページ')).toBeVisible();

  await page
    .locator('.bookshelf-detail-tabs button')
    .filter({ hasText: '予定' })
    .click();
  await expect(page.getByText('アルゴリズム問題集を進める')).toBeVisible();

  await page.getByRole('button', { name: '教材メニューを開く' }).click();
  await expect(page.getByText('教材内構造を編集')).toBeVisible();
  await expect(page.getByText('よく使う教材から外す')).toBeVisible();
});

test.describe('mobile bookshelf containment', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('keeps the bookshelf and bottom navigation inside the viewport', async ({ page }) => {
    await seedBookshelf(page);
    await openBookshelf(page);
    await page.waitForTimeout(300);

    const metrics = await page.evaluate(() => {
      const nav = document.querySelector('.primary-bottom-nav');
      const shell = document.querySelector('.app-shell');
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        navWidth: nav?.getBoundingClientRect().width ?? 0,
        shellWidth: shell?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.navWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.shellWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  });
});