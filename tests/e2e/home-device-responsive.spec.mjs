import { expect, test } from '@playwright/test';

async function seedHome(page) {
  await page.addInitScript(() => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'device-layout-user',
      email: 'device-layout@example.com',
      username: 'device-layout-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'device-layout-plan',
      seriesId: 'device-layout-plan',
      userId: user.id,
      title: '情報資源総論',
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: '10:20',
      endTime: '11:50',
      memo: '',
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'device-layout-material',
      userId: user.id,
      name: '基本情報技術者テキスト',
      subjectId: 'device-layout-subject',
      subjectName: '情報科学',
      status: 'active',
      progressUnit: 'page',
      totalUnits: 500,
      currentUnit: 120,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  });
}

async function readMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const shell = document.querySelector('.home-app-shell');
    const nav = document.querySelector('.home-bottom-nav');
    const core = document.querySelector('.home-core-sections');
    const lastCore = core?.lastElementChild ?? null;
    const materials = [...document.querySelectorAll('.home-material-panel')].filter(visible);
    const material = materials[0] ?? null;
    const today = document.querySelector('.home-today-panel');
    const attention = document.querySelector('.home-alert-grid');
    const schedule = document.querySelector('.home-schedule-list');
    const addRow = document.querySelector('.home-schedule-add-row');
    const nextMeta = document.querySelector('.home-next-meta');
    const startButton = document.querySelector('.home-start-button');
    const navTop = nav?.getBoundingClientRect().top ?? 0;
    const lastVisibleBottom = material?.getBoundingClientRect().bottom ?? lastCore?.getBoundingClientRect().bottom ?? 0;

    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
      navWidth: nav?.getBoundingClientRect().width ?? 0,
      bottomGap: navTop - lastVisibleBottom,
      materialCount: materials.length,
      scheduleClientHeight: schedule?.clientHeight ?? 0,
      scheduleScrollHeight: schedule?.scrollHeight ?? 0,
      addRowBottom: addRow?.getBoundingClientRect().bottom ?? null,
      scheduleBottom: schedule?.getBoundingClientRect().bottom ?? null,
      todayBottom: today?.getBoundingClientRect().bottom ?? null,
      attentionTop: attention?.getBoundingClientRect().top ?? null,
      nextMetaBottom: nextMeta?.getBoundingClientRect().bottom ?? null,
      startButtonTop: startButton?.getBoundingClientRect().top ?? null,
    };
  });
}

function expectCommonBounds(metrics) {
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.pageHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.bottomGap).toBeGreaterThanOrEqual(-1);
  expect(metrics.bottomGap).toBeLessThanOrEqual(24);
  expect(metrics.materialCount).toBeLessThanOrEqual(1);
  if (metrics.nextMetaBottom !== null && metrics.startButtonTop !== null) {
    expect(metrics.nextMetaBottom).toBeLessThanOrEqual(metrics.startButtonTop - 2);
  }
  if (metrics.todayBottom !== null && metrics.attentionTop !== null) {
    expect(metrics.todayBottom).toBeLessThanOrEqual(metrics.attentionTop + 1);
  }
  if (metrics.addRowBottom !== null && metrics.scheduleBottom !== null) {
    expect(metrics.addRowBottom).toBeLessThanOrEqual(metrics.scheduleBottom + 1);
  }
}

const galaxyUse = {
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36',
};

test.describe('Galaxy-class 360x640 mobile viewport', () => {
  test.use(galaxyUse);

  test('prioritizes the core dashboard without clipping the add row', async ({ page }) => {
    await seedHome(page);
    await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await page.waitForTimeout(500);

    const metrics = await readMetrics(page);
    expectCommonBounds(metrics);
    expect(metrics.materialCount).toBe(0);
    expect(metrics.shellWidth).toBeGreaterThanOrEqual(350);
  });
});

const ipadPortraitUse = {
  viewport: { width: 1024, height: 1366 },
  screen: { width: 1024, height: 1366 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

test.describe('iPad-class portrait viewport', () => {
  test.use(ipadPortraitUse);

  test('uses most of the tablet width and keeps the bottom area filled', async ({ page }) => {
    await seedHome(page);
    await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await page.waitForTimeout(700);

    const metrics = await readMetrics(page);
    expectCommonBounds(metrics);
    expect(metrics.shellWidth / metrics.viewportWidth).toBeGreaterThanOrEqual(0.9);
    expect(Math.abs(metrics.navWidth - metrics.shellWidth)).toBeLessThanOrEqual(2);
  });
});

const ipadLandscapeUse = {
  ...ipadPortraitUse,
  viewport: { width: 1366, height: 1024 },
  screen: { width: 1366, height: 1024 },
};

test.describe('iPad-class landscape viewport', () => {
  test.use(ipadLandscapeUse);

  test('stays proportionally large without horizontal overflow', async ({ page }) => {
    await seedHome(page);
    await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await page.waitForTimeout(700);

    const metrics = await readMetrics(page);
    expectCommonBounds(metrics);
    expect(metrics.shellWidth).toBeGreaterThanOrEqual(1000);
    expect(Math.abs(metrics.navWidth - metrics.shellWidth)).toBeLessThanOrEqual(2);
  });
});
