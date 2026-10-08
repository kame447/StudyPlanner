import { expect, test } from './support/fixed-clock.mjs';

const VIEWPORTS = [
  { name: 'small-phone', width: 320, height: 568, materialFits: false, scrollBody: true },
  { name: 'compact-phone', width: 360, height: 640, materialFits: false },
  { name: 'classic-phone', width: 375, height: 667, materialFits: false },
  { name: 'modern-phone', width: 390, height: 844, materialFits: true },
  { name: 'modern-phone-tall', width: 393, height: 852, materialFits: true },
  { name: 'android-phone', width: 412, height: 915, materialFits: true },
  { name: 'large-phone', width: 430, height: 932, materialFits: true },
  { name: 'home-reference', width: 511, height: 1094, materialFits: true },
  { name: 'blackberry-devtools', width: 768, height: 710, materialFits: true },
  { name: 'landscape-tablet', width: 1024, height: 768, materialFits: true },
  { name: 'short-landscape', width: 852, height: 393, materialFits: false, scrollBody: true },
];

const MAX_BOTTOM_GAP = 18;

async function seedHomeState(page, planCount = 1) {
  await page.addInitScript(({ count }) => {
    const today = new Date().toLocaleDateString('sv-SE');
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
    const addScheduleRow = document.querySelector('.home-schedule-add-row, .home-schedule-empty');
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

async function expectScheduleTailAccessible(page, metrics) {
  const scheduleIsScrollable = metrics.scheduleScrollHeight > metrics.scheduleClientHeight + 1;
  if (!scheduleIsScrollable) {
    if (metrics.addScheduleBottom !== null && metrics.scheduleBottom !== null) {
      expect(metrics.addScheduleBottom).toBeLessThanOrEqual(metrics.scheduleBottom + 1);
    }
    return;
  }

  const tail = await page.evaluate(() => {
    const schedule = document.querySelector('.home-schedule-list');
    const addRow = document.querySelector('.home-schedule-add-row, .home-schedule-empty');
    if (!(schedule instanceof HTMLElement) || !(addRow instanceof HTMLElement)) {
      return null;
    }

    schedule.scrollTop = schedule.scrollHeight;
    const scheduleRect = schedule.getBoundingClientRect();
    const addRowRect = addRow.getBoundingClientRect();
    return {
      overflowY: getComputedStyle(schedule).overflowY,
      scrollTop: schedule.scrollTop,
      maxScrollTop: schedule.scrollHeight - schedule.clientHeight,
      scheduleTop: scheduleRect.top,
      scheduleBottom: scheduleRect.bottom,
      addRowTop: addRowRect.top,
      addRowBottom: addRowRect.bottom,
    };
  });

  expect(tail).not.toBeNull();
  expect(['auto', 'scroll']).toContain(tail.overflowY);
  expect(tail.maxScrollTop).toBeGreaterThan(0);
  expect(tail.scrollTop).toBeGreaterThanOrEqual(tail.maxScrollTop - 1);
  expect(tail.addRowTop).toBeGreaterThanOrEqual(tail.scheduleTop - 1);
  expect(tail.addRowBottom).toBeLessThanOrEqual(tail.scheduleBottom + 1);
}

async function expectCompactHomeReachable(page, testInfo, name, { browserName, isMobile }) {
  const body = page.locator('.home-main > .home-dashboard-default');
  const header = page.locator('.primary-app-header');
  const nav = page.locator('.primary-bottom-nav');
  const initialHeader = await header.boundingBox();
  const initialNav = await nav.boundingBox();
  await expect(body).toHaveCSS('overflow-y', 'auto');
  expect(await body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  if (browserName !== 'webkit' || !isMobile) {
    const bodyBox = await body.boundingBox();
    const before = await body.evaluate(element => element.scrollTop);
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  }

  const expectInsideBody = async (target) => {
    await target.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const outer = await body.boundingBox();
      const inner = await target.boundingBox();
      return outer && inner && inner.y >= outer.y - 1
        && inner.y + inner.height <= outer.y + outer.height + 1
        && inner.x >= outer.x - 1 && inner.x + inner.width <= outer.x + outer.width + 1;
    }).toBe(true);
    expect(await header.boundingBox()).toEqual(initialHeader);
    expect(await nav.boundingBox()).toEqual(initialNav);
    const outer = await body.boundingBox();
    expect(outer.y).toBeGreaterThanOrEqual(initialHeader.y + initialHeader.height - 1);
    expect(outer.y + outer.height).toBeLessThanOrEqual(initialNav.y + 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  };

  // Chromium proves the native wheel path above. Mobile WebKit has no wheel
  // API, so the checks below establish reader positions through DOM scrolling
  // and verify real layout/control behavior; they do not prove iOS gestures.
  for (const selector of ['.home-next-card', '.home-today-panel', '.home-alert-grid', '.home-progress-panel']) {
    await expectInsideBody(page.locator(selector));
  }
  const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
  await expectInsideBody(add);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await add.click();
  const chooser = page.getByRole('dialog', { name: '今日の予定に追加', exact: true });
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(chooser).toBeHidden();
  await expectInsideBody(add);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} keeps the single-plan home layout bounded`, async ({ page, browserName, isMobile }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedHomeState(page, 1);
    await page.goto('/');

    const home = page.locator('.home-main > .home-dashboard-default');
    await expect(home).toBeVisible();
    await page.waitForTimeout(400);

    const metrics = await readHomeMetrics(page);

    expectNoStructuralOverlap(metrics);
    if (!viewport.scrollBody) expectBottomSpaceUsed(metrics);
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.visibleMaterialPanelCount, JSON.stringify(metrics)).toBe(viewport.materialFits ? 1 : 0);
    expect(metrics.visibleMaterialPanelCount).toBeLessThanOrEqual(1);
    expect(metrics.materialProbeVisibility).toBe('hidden');
    if (!viewport.scrollBody) expect(metrics.lastCoreBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    if (metrics.materialBottom !== null) {
      expect(metrics.materialBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    }
    expect(metrics.progressHeight).toBeLessThanOrEqual(140);
    await expectScheduleTailAccessible(page, metrics);
    if (viewport.scrollBody) await expectCompactHomeReachable(page, testInfo, `home-${viewport.name}-single-plan-tail`, { browserName, isMobile });
  });

  test(`${viewport.name} ${viewport.width}x${viewport.height} prioritizes four plans over material progress`, async ({ page, browserName, isMobile }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedHomeState(page, 4);
    await page.goto('/');

    const home = page.locator('.home-main > .home-dashboard-default');
    await expect(home).toBeVisible();
    await page.waitForTimeout(450);

    const metrics = await readHomeMetrics(page);
    const scheduleIsScrollable = metrics.scheduleScrollHeight > metrics.scheduleClientHeight + 1;

    expectNoStructuralOverlap(metrics);
    if (!viewport.scrollBody) expectBottomSpaceUsed(metrics);
    expect(metrics.scheduleRowCount).toBe(4);
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.visibleMaterialPanelCount).toBeLessThanOrEqual(1);
    expect(metrics.materialProbeVisibility).toBe('hidden');
    if (!viewport.scrollBody) expect(metrics.lastCoreBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    if (metrics.materialBottom !== null) {
      expect(metrics.materialBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    }
    // The new plus action is the scrollable tail after the plan rows. Material
    // progress is excluded only when one of the four plans itself does not fit.
    if (metrics.fourthScheduleBottom !== null && metrics.scheduleBottom !== null) {
      if (metrics.fourthScheduleBottom > metrics.scheduleBottom + 1) {
        expect(scheduleIsScrollable).toBe(true);
        expect(metrics.visibleMaterialPanelCount, JSON.stringify(metrics)).toBe(0);
      } else {
        expect(metrics.fourthScheduleBottom).toBeLessThanOrEqual(metrics.scheduleBottom + 1);
      }
    }

    await expectScheduleTailAccessible(page, metrics);
    if (viewport.scrollBody) await expectCompactHomeReachable(page, testInfo, `home-${viewport.name}-four-plan-tail`, { browserName, isMobile });
    if (viewport.name === 'blackberry-devtools') {
      expect(scheduleIsScrollable).toBe(true);
      expect(metrics.visibleMaterialPanelCount).toBe(0);
    }
    if (viewport.name === 'home-reference') {
      expect(scheduleIsScrollable).toBe(true);
      expect(metrics.visibleMaterialPanelCount).toBe(1);
    }
  });
}
