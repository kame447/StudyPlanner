import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'small-phone', width: 320, height: 568, materialFits: false },
  { name: 'compact-phone', width: 360, height: 640, materialFits: false },
  { name: 'classic-phone', width: 375, height: 667, materialFits: false },
  { name: 'modern-phone', width: 390, height: 844, materialFits: true },
  { name: 'modern-phone-tall', width: 393, height: 852, materialFits: true },
  { name: 'android-phone', width: 412, height: 915, materialFits: true },
  { name: 'large-phone', width: 430, height: 932, materialFits: true },
  { name: 'home-reference', width: 511, height: 1094, materialFits: true },
  { name: 'blackberry-devtools', width: 768, height: 710, materialFits: true },
  { name: 'landscape-tablet', width: 1024, height: 768, materialFits: true },
];

const MAX_BOTTOM_GAP = 18;

async function seedHomeState(page, planCount = 1) {
  await page.addInitScript(({ count }) => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'home-layout-user',
      email: 'home-layout@example.com',
      username: 'home-layout-user',
      avatar: '',
      createdAt: now,
    };
    const slots = [
      ['20:10', '20:40'],
      ['20:50', '21:20'],
      ['21:30', '22:00'],
      ['22:10', '22:40'],
    ];
    const plans = Array.from({ length: count }, (_, index) => ({
      id: `home-layout-plan-${index + 1}`,
      seriesId: `home-layout-plan-${index + 1}`,
      userId: user.id,
      title: `情報資源総論 ${index + 1}`,
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: slots[index]?.[0] ?? '22:50',
      endTime: slots[index]?.[1] ?? '23:20',
      memo: '',
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    }));
    const material = {
      id: 'home-layout-material',
      userId: user.id,
      name: '基本情報技術者テキスト',
      subjectId: 'home-layout-subject',
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
    localStorage.setItem('studyplanner.plans', JSON.stringify(plans));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  }, { count: planCount });
}

async function readHomeMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const materialPanels = [...document.querySelectorAll('.home-material-panel')];
    const visibleMaterialPanels = materialPanels.filter(visible);
    const visibleMaterial = visibleMaterialPanels[0] ?? null;
    const nav = document.querySelector('.home-bottom-nav');
    const progress = document.querySelector('.home-progress-panel');
    const scheduleList = document.querySelector('.home-schedule-list');
    const scheduleRows = [...document.querySelectorAll('.home-schedule-row')];
    const addScheduleRow = document.querySelector('.home-schedule-add-row');
    const core = document.querySelector('.home-core-sections');
    const lastCore = core?.lastElementChild ?? null;
    const navRect = nav?.getBoundingClientRect() ?? null;
    const lastCoreRect = lastCore?.getBoundingClientRect() ?? null;
    const materialRect = visibleMaterial?.getBoundingClientRect() ?? null;
    const addScheduleRect = addScheduleRow?.getBoundingClientRect() ?? null;
    const fourthScheduleRect = scheduleRows[3]?.getBoundingClientRect() ?? null;
    const scheduleRect = scheduleList?.getBoundingClientRect() ?? null;
    const measurementRoot = document.querySelector('.home-material-measurements');
    const topbarRect = rect('.home-topbar');
    const nextCardRect = rect('.home-next-card');
    const nextMetaRect = rect('.home-next-meta');
    const startButtonRect = rect('.home-start-button');
    const todayRect = rect('.home-today-panel');
    const attentionRect = rect('.home-alert-grid');
    const progressRect = rect('.home-progress-panel');
    const lastVisibleBottom = materialRect?.bottom ?? lastCoreRect?.bottom ?? 0;

    return {
      viewportHeight: document.documentElement.clientHeight,
      pageScrollHeight: document.documentElement.scrollHeight,
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      visibleMaterialPanelCount: visibleMaterialPanels.length,
      materialProbeVisibility: measurementRoot
        ? getComputedStyle(measurementRoot).visibility
        : 'missing',
      lastCoreBottom: lastCoreRect?.bottom ?? 0,
      materialBottom: materialRect?.bottom ?? null,
      navTop: navRect?.top ?? 0,
      bottomGap: (navRect?.top ?? 0) - lastVisibleBottom,
      progressHeight: progress?.getBoundingClientRect().height ?? 0,
      scheduleRowCount: scheduleRows.length,
      scheduleClientHeight: scheduleList?.clientHeight ?? 0,
      scheduleScrollHeight: scheduleList?.scrollHeight ?? 0,
      addScheduleBottom: addScheduleRect?.bottom ?? null,
      fourthScheduleBottom: fourthScheduleRect?.bottom ?? null,
      scheduleBottom: scheduleRect?.bottom ?? null,
      topbarBottom: topbarRect?.bottom ?? null,
      nextCardTop: nextCardRect?.top ?? null,
      nextCardBottom: nextCardRect?.bottom ?? null,
      nextMetaBottom: nextMetaRect?.bottom ?? null,
      startButtonTop: startButtonRect?.top ?? null,
      todayTop: todayRect?.top ?? null,
      todayBottom: todayRect?.bottom ?? null,
      attentionTop: attentionRect?.top ?? null,
      attentionBottom: attentionRect?.bottom ?? null,
      progressTop: progressRect?.top ?? null,
    };
  });
}

function expectNoStructuralOverlap(metrics) {
  if (metrics.nextMetaBottom !== null && metrics.startButtonTop !== null) {
    expect(metrics.nextMetaBottom).toBeLessThanOrEqual(metrics.startButtonTop - 2);
  }
  if (metrics.topbarBottom !== null && metrics.nextCardTop !== null) {
    expect(metrics.topbarBottom).toBeLessThanOrEqual(metrics.nextCardTop + 1);
  }
  if (metrics.nextCardBottom !== null && metrics.todayTop !== null) {
    expect(metrics.nextCardBottom).toBeLessThanOrEqual(metrics.todayTop + 1);
  }
  if (metrics.todayBottom !== null && metrics.attentionTop !== null) {
    expect(metrics.todayBottom).toBeLessThanOrEqual(metrics.attentionTop + 1);
  }
  if (metrics.attentionBottom !== null && metrics.progressTop !== null) {
    expect(metrics.attentionBottom).toBeLessThanOrEqual(metrics.progressTop + 1);
  }
}

function expectBottomSpaceUsed(metrics) {
  expect(metrics.bottomGap).toBeGreaterThanOrEqual(-1);
  expect(metrics.bottomGap).toBeLessThanOrEqual(MAX_BOTTOM_GAP);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} keeps the single-plan home layout bounded`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedHomeState(page, 1);
    await page.goto('/');

    const home = page.locator('.home-main > .home-dashboard-default');
    await expect(home).toBeVisible();
    await page.waitForTimeout(400);

    const metrics = await readHomeMetrics(page);

    expectNoStructuralOverlap(metrics);
    expectBottomSpaceUsed(metrics);
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.visibleMaterialPanelCount).toBe(viewport.materialFits ? 1 : 0);
    expect(metrics.visibleMaterialPanelCount).toBeLessThanOrEqual(1);
    expect(metrics.materialProbeVisibility).toBe('hidden');
    expect(metrics.lastCoreBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    if (metrics.materialBottom !== null) {
      expect(metrics.materialBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    }
    expect(metrics.progressHeight).toBeLessThanOrEqual(140);
    expect(metrics.scheduleScrollHeight).toBeLessThanOrEqual(metrics.scheduleClientHeight + 1);
    if (metrics.addScheduleBottom !== null && metrics.scheduleBottom !== null) {
      expect(metrics.addScheduleBottom).toBeLessThanOrEqual(metrics.scheduleBottom + 1);
    }
  });

  test(`${viewport.name} ${viewport.width}x${viewport.height} prioritizes four plans over material progress`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedHomeState(page, 4);
    await page.goto('/');

    const home = page.locator('.home-main > .home-dashboard-default');
    await expect(home).toBeVisible();
    await page.waitForTimeout(450);

    const metrics = await readHomeMetrics(page);
    const scheduleIsScrollable = metrics.scheduleScrollHeight > metrics.scheduleClientHeight + 1;

    expectNoStructuralOverlap(metrics);
    expectBottomSpaceUsed(metrics);
    expect(metrics.scheduleRowCount).toBe(4);
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.visibleMaterialPanelCount).toBeLessThanOrEqual(1);
    expect(metrics.materialProbeVisibility).toBe('hidden');
    expect(metrics.lastCoreBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    if (metrics.materialBottom !== null) {
      expect(metrics.materialBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    }
    if (scheduleIsScrollable) {
      expect(metrics.visibleMaterialPanelCount).toBe(0);
    } else if (metrics.fourthScheduleBottom !== null && metrics.scheduleBottom !== null) {
      expect(metrics.fourthScheduleBottom).toBeLessThanOrEqual(metrics.scheduleBottom + 1);
    }

    if (viewport.name === 'blackberry-devtools') {
      expect(scheduleIsScrollable).toBe(false);
      expect(metrics.visibleMaterialPanelCount).toBe(0);
    }
    if (viewport.name === 'home-reference') {
      expect(scheduleIsScrollable).toBe(false);
      expect(metrics.visibleMaterialPanelCount).toBe(1);
    }
  });
}
