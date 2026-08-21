import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'desktop-1280x720', width: 1280, height: 720 },
  { name: 'tablet-1024x1366', width: 1024, height: 1366 },
];

async function seedAuthenticatedUser(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const user = {
      id: 'primary-chrome-e2e-user',
      email: 'primary-chrome@example.com',
      username: 'primary-chrome',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'primary-chrome-e2e-plan',
      seriesId: 'primary-chrome-e2e-plan',
      userId: user.id,
      title: 'ヘッダー監査用の予定',
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: '19:00',
      endTime: '20:00',
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
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function openPrimarySurface(page, label) {
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: label })
    .click();
}

async function readChromeMetrics(page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector('.primary-app-header');
    const header = wrapper?.querySelector('.home-topbar');
    const nav = document.querySelector('.primary-bottom-nav');
    if (
      !(wrapper instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(nav instanceof HTMLElement)
    ) {
      throw new Error('primary chrome is missing');
    }

    const streak = header.querySelector('.home-streak-card');
    const date = header.querySelector('.home-date-display');
    const actions = header.querySelector('.home-top-actions');
    const iconButton = header.querySelector('.home-icon-button');
    const activeCircle = nav.querySelector('.home-nav-active-circle');
    const navButton = nav.querySelector('button');
    const navIcon = navButton?.querySelector('svg');
    const navLabel = navButton?.querySelector('span:last-child');

    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    const px = (value) => Number.parseFloat(value || '0') || 0;

    const headerBox = rect(header);
    const childBoxes = [streak, date, actions].map(rect).filter(Boolean);
    const childrenContained = childBoxes.every(
      (box) =>
        headerBox &&
        box.x >= headerBox.x - 0.75 &&
        box.right <= headerBox.right + 0.75 &&
        box.y >= headerBox.y - 0.75 &&
        box.bottom <= headerBox.bottom + 0.75,
    );

    const headerStyle = getComputedStyle(header);
    const navStyle = getComputedStyle(nav);
    const iconStyle = iconButton instanceof Element ? getComputedStyle(iconButton) : null;
    const activeStyle = activeCircle instanceof Element ? getComputedStyle(activeCircle) : null;
    const navIconStyle = navIcon instanceof Element ? getComputedStyle(navIcon) : null;
    const navLabelStyle = navLabel instanceof Element ? getComputedStyle(navLabel) : null;

    return {
      wrapper: rect(wrapper),
      header: headerBox,
      streak: rect(streak),
      date: rect(date),
      actions: rect(actions),
      iconButton: rect(iconButton),
      nav: rect(nav),
      activeCircle: rect(activeCircle),
      headerGrid: headerStyle.gridTemplateColumns,
      headerGap: px(headerStyle.columnGap),
      navPaddingTop: px(navStyle.paddingTop),
      navPaddingBottom: px(navStyle.paddingBottom),
      navIconWidth: navIconStyle ? px(navIconStyle.width) : 0,
      navIconHeight: navIconStyle ? px(navIconStyle.height) : 0,
      navLabelSize: navLabelStyle ? px(navLabelStyle.fontSize) : 0,
      activeMarginTop: activeStyle ? px(activeStyle.marginTop) : 0,
      iconButtonWidth: iconStyle ? px(iconStyle.width) : 0,
      iconButtonHeight: iconStyle ? px(iconStyle.height) : 0,
      headerScrollWidth: header.scrollWidth,
      headerClientWidth: header.clientWidth,
      topbarRelaxation: wrapper.style.getPropertyValue('--home-relax-topbar'),
      chromeViewport: wrapper.dataset.homeChromeViewport ?? '',
      childrenContained,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

async function markPersistentChrome(page) {
  await page.evaluate(() => {
    const header = document.querySelector('.primary-app-header');
    const nav = document.querySelector('.primary-bottom-nav');
    if (!(header instanceof HTMLElement) || !(nav instanceof HTMLElement)) {
      throw new Error('primary chrome is missing');
    }
    header.dataset.chromeAuditIdentity = 'persistent-header';
    nav.dataset.chromeAuditIdentity = 'persistent-nav';
  });
}

async function expectPersistentChrome(page) {
  await expect(page.locator('.primary-app-header')).toHaveAttribute(
    'data-chrome-audit-identity',
    'persistent-header',
  );
  await expect(page.locator('.primary-bottom-nav')).toHaveAttribute(
    'data-chrome-audit-identity',
    'persistent-nav',
  );
}

function expectRectToMatch(actual, expected, fields, tolerance = 1) {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  for (const field of fields) {
    expect(Math.abs(actual[field] - expected[field]), field).toBeLessThanOrEqual(tolerance);
  }
}

function expectChromeToMatchHome(actual, home) {
  expectRectToMatch(actual.wrapper, home.wrapper, ['x', 'y', 'width', 'height']);
  expectRectToMatch(actual.header, home.header, ['x', 'y', 'width', 'height']);
  expectRectToMatch(actual.streak, home.streak, ['width', 'height']);
  expectRectToMatch(actual.date, home.date, ['width', 'height']);
  expectRectToMatch(actual.actions, home.actions, ['width', 'height']);
  expectRectToMatch(actual.iconButton, home.iconButton, ['width', 'height']);
  expectRectToMatch(actual.nav, home.nav, ['x', 'y', 'width', 'height']);
  expectRectToMatch(actual.activeCircle, home.activeCircle, ['width', 'height']);

  expect(actual.headerGrid).toBe(home.headerGrid);
  expect(Math.abs(actual.headerGap - home.headerGap)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.navPaddingTop - home.navPaddingTop)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.navPaddingBottom - home.navPaddingBottom)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.navIconWidth - home.navIconWidth)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.navIconHeight - home.navIconHeight)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.navLabelSize - home.navLabelSize)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.activeMarginTop - home.activeMarginTop)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.iconButtonWidth - home.iconButtonWidth)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(actual.iconButtonHeight - home.iconButtonHeight)).toBeLessThanOrEqual(0.25);
  expect(actual.topbarRelaxation).toBe(home.topbarRelaxation);
  expect(actual.chromeViewport).toBe(home.chromeViewport);

  expect(actual.headerScrollWidth).toBeLessThanOrEqual(actual.headerClientWidth + 1);
  expect(actual.childrenContained).toBe(true);
  expect(actual.pageWidth).toBeLessThanOrEqual(actual.viewportWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} keeps Home, AI planning, and Bookshelf chrome identical`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedAuthenticatedUser(page);
    await mkdir(`artifacts/chrome-audit/${viewport.name}`, { recursive: true });

    await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await expect
      .poll(() => page.locator('.primary-app-header').getAttribute('data-home-chrome-viewport'))
      .not.toBeNull();
    await markPersistentChrome(page);
    await page.waitForTimeout(250);
    const home = await readChromeMetrics(page);
    await page.screenshot({
      path: `artifacts/chrome-audit/${viewport.name}/home.png`,
      fullPage: false,
    });

    await openPrimarySurface(page, 'AI計画');
    await expect(page.locator('.ai-planning-view')).toBeVisible();
    await expectPersistentChrome(page);
    await page.waitForTimeout(250);
    const aiPlanning = await readChromeMetrics(page);
    expectChromeToMatchHome(aiPlanning, home);
    await page.screenshot({
      path: `artifacts/chrome-audit/${viewport.name}/ai-planning.png`,
      fullPage: false,
    });

    await openPrimarySurface(page, '教材');
    await expect(page.locator('.bookshelf-view')).toBeVisible();
    await expectPersistentChrome(page);
    await page.waitForTimeout(250);
    const bookshelf = await readChromeMetrics(page);
    expectChromeToMatchHome(bookshelf, home);
    await page.screenshot({
      path: `artifacts/chrome-audit/${viewport.name}/bookshelf.png`,
      fullPage: false,
    });

    await openPrimarySurface(page, 'ホーム');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await expectPersistentChrome(page);
    await page.waitForTimeout(250);
    const homeAgain = await readChromeMetrics(page);
    expectChromeToMatchHome(homeAgain, home);
  });
}
