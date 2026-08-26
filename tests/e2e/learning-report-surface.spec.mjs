import { expect, test } from '@playwright/test';

async function seedLearningReport(page) {
  await page.addInitScript(() => {
    const toLocalDate = (date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    const todayDate = new Date();
    const today = toLocalDate(todayDate);
    const previousMonthDate = new Date(todayDate);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    previousMonthDate.setDate(1);
    const previousMonth = toLocalDate(previousMonthDate);
    const now = new Date().toISOString();
    const user = {
      id: 'learning-report-e2e-user',
      email: 'learning-report@example.com',
      username: 'learning-report-e2e',
      avatar: '',
      createdAt: now,
    };
    const infoSubject = {
      id: 'learning-report-subject-info',
      userId: user.id,
      name: '情報科学',
      color: '#7b61d1',
      createdAt: now,
      updatedAt: now,
    };
    const researchSubject = {
      id: 'learning-report-subject-research',
      userId: user.id,
      name: '研究',
      color: '#2f9b7a',
      createdAt: now,
      updatedAt: now,
    };
    const algorithmMaterial = {
      id: 'learning-report-material-algorithm',
      userId: user.id,
      name: 'アルゴリズムイントロダクション',
      subjectId: infoSubject.id,
      subjectName: infoSubject.name,
      color: infoSubject.color,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const researchMaterial = {
      id: 'learning-report-material-research',
      userId: user.id,
      name: '卒業研究ノート',
      subjectId: researchSubject.id,
      subjectName: researchSubject.name,
      color: researchSubject.color,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const plan = {
      id: 'learning-report-plan-today',
      seriesId: 'learning-report-plan-today',
      userId: user.id,
      title: 'アルゴリズム演習',
      subject: infoSubject.name,
      date: today,
      startTime: '09:00',
      endTime: '11:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: 'study',
      memo: '',
      sourceType: 'manual',
      materialId: algorithmMaterial.id,
      materialName: algorithmMaterial.name,
      createdAt: now,
      updatedAt: now,
    };
    const actuals = [
      {
        id: 'learning-report-actual-today',
        userId: user.id,
        planId: plan.id,
        occurrenceDate: today,
        actualStartTime: '09:00',
        actualEndTime: '10:30',
        title: 'アルゴリズム演習',
        subject: infoSubject.name,
        isAlignedToPlan: true,
        note: '',
        materialId: algorithmMaterial.id,
        materialName: algorithmMaterial.name,
        updatedAt: now,
      },
      {
        id: 'learning-report-actual-old',
        userId: user.id,
        planId: null,
        occurrenceDate: previousMonth,
        actualStartTime: '18:00',
        actualEndTime: '18:30',
        title: '卒業研究',
        subject: researchSubject.name,
        isAlignedToPlan: false,
        note: '',
        materialId: researchMaterial.id,
        materialName: researchMaterial.name,
        updatedAt: now,
      },
    ];

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', JSON.stringify(actuals));
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem(
      'studyplanner.studySubjects.v1',
      JSON.stringify([infoSubject, researchSubject]),
    );
    localStorage.setItem(
      'studyplanner.studyMaterials.v1',
      JSON.stringify([algorithmMaterial, researchMaterial]),
    );
  });
}

async function openLearningReport(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今週の進捗' })).toBeVisible();
  await page.getByRole('button', { name: /詳細を見る/ }).click();
  await expect(page.locator('.learning-report-view')).toBeVisible();
}

test('opens the learning report as a home secondary surface', async ({ page }) => {
  await seedLearningReport(page);
  await openLearningReport(page);

  await expect(page.getByRole('heading', { name: '学習レポート' })).toBeVisible();
  await expect(page.locator('.app-view-switcher')).toHaveCount(0);
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await expect(
    page.locator('.primary-bottom-nav button[aria-current="page"]'),
  ).toContainText('ホーム');

  const todayCard = page.locator('.learning-report-summary-card').filter({ hasText: '今日' });
  const weekCard = page.locator('.learning-report-summary-card').filter({ hasText: '今週' });
  const monthCard = page.locator('.learning-report-summary-card').filter({ hasText: '今月' });
  const lifetimeCard = page.locator('.learning-report-summary-card').filter({ hasText: '累計' });

  await expect(todayCard).toContainText('1.5時間');
  await expect(todayCard).toContainText('予定 2時間');
  await expect(weekCard).toContainText('1.5時間');
  await expect(monthCard).toContainText('1.5時間');
  await expect(lifetimeCard).toContainText('2時間');

  await expect(page.getByRole('tab', { name: '週' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: '学習時間の推移' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '教材・科目別の学習時間' }),
  ).toBeVisible();
  await expect(page.getByText('アルゴリズムイントロダクション').first()).toBeVisible();

  const trend = page.getByRole('list', { name: /の学習時間 合計/ });
  await expect(trend).toBeVisible();
  await expect(trend.getByRole('listitem')).toHaveCount(7);

  await page
    .getByLabel('表示する教材')
    .selectOption('material:learning-report-material-algorithm');
  await expect(page.getByText('合計 1.5時間')).toBeVisible();

  await page.getByRole('tab', { name: '月' }).click();
  await expect(page.getByRole('tab', { name: '月' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('button', { name: 'ホームに戻る' }).click();
  await expect(page.getByRole('heading', { name: '今週の進捗' })).toBeVisible();
});

test.describe('mobile learning report containment', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('keeps the report and navigation inside the viewport', async ({ page }, testInfo) => {
    await seedLearningReport(page);
    await openLearningReport(page);
    await page.waitForTimeout(250);

    const metrics = await page.evaluate(() => {
      const nav = document.querySelector('.primary-bottom-nav');
      const report = document.querySelector('.learning-report-view');
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        navWidth: nav?.getBoundingClientRect().width ?? 0,
        reportWidth: report?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.navWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.reportWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach('learning-report-mobile', {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});
