import { mkdir } from 'node:fs/promises';
import { expect, test } from './support/startup-ready.mjs';

const VIEWPORTS = [
  { name: 'small-phone-320x568', width: 320, height: 568 },
  { name: 'small-phone-320x852-text-200', width: 320, height: 852, textScale: 200 },
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'mobile-393x852', width: 393, height: 852 },
  { name: 'short-landscape-852x393', width: 852, height: 393 },
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
    const navButton = [...nav.querySelectorAll('button')]
      .find((button) => !button.classList.contains('active')) ?? null;
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
      navButtonWidths: [...nav.querySelectorAll('button')].map(button => button.getBoundingClientRect().width),
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
  actual.navButtonWidths.forEach((width, index) => {
    expect(Math.abs(width - home.navButtonWidths[index]), `nav button ${index} width`).toBeLessThanOrEqual(1);
  });
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

async function auditSurface(page, home, viewportName, label, readySelector, fileName) {
  await openPrimarySurface(page, label);
  await expect(page.locator(readySelector)).toBeVisible();
  await expectPersistentChrome(page);
  await page.waitForTimeout(250);
  const metrics = await readChromeMetrics(page);
  expectChromeToMatchHome(metrics, home);
  await page.screenshot({
    path: `artifacts/chrome-audit/${viewportName}/${fileName}.png`,
    fullPage: false,
  });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} keeps primary chrome fixed across all main pages`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedAuthenticatedUser(page);
    await mkdir(`artifacts/chrome-audit/${viewport.name}`, { recursive: true });

    await page.goto('/');
    if (viewport.textScale) await page.addStyleTag({ content: `:root { font-size: ${viewport.textScale}% !important; }` });
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    if (viewport.textScale) {
      // Enlarged text deliberately bypasses compact fitting and scrolls the Home body.
      await expect(page.locator('.home-main > .home-dashboard-default'))
        .toHaveAttribute('data-content-scroll', 'true');
    } else {
      await expect
        .poll(() => page.locator('.primary-app-header').getAttribute('data-home-chrome-viewport'))
        .not.toBeNull();
    }
    await markPersistentChrome(page);
    await page.waitForTimeout(250);
    const home = await readChromeMetrics(page);
    if (viewport.textScale) {
      const dashboard = page.locator('.home-main > .home-dashboard-default');
      await expect(dashboard).toHaveCSS('overflow-y', 'auto');
      await dashboard.hover();
      await page.mouse.wheel(0, 800);
      await expect.poll(() => dashboard.evaluate(element => element.scrollTop))
        .toBeGreaterThan(0);
      expectChromeToMatchHome(await readChromeMetrics(page), home);
      for (const button of await page.locator('.primary-app-header button, .primary-bottom-nav button').all()) {
        await button.click({ trial: true });
      }
      expect(await page.evaluate(() => ({
        top: document.documentElement.scrollTop,
        body: document.body.scrollTop,
        height: document.documentElement.scrollHeight,
        client: document.documentElement.clientHeight,
      }))).toEqual({ top: 0, body: 0, height: viewport.height, client: viewport.height });
    }
    await page.screenshot({
      path: `artifacts/chrome-audit/${viewport.name}/home.png`,
      fullPage: false,
    });

    await auditSurface(page, home, viewport.name, 'AI計画', '.ai-planning-view', 'ai-planning');
    await auditSurface(page, home, viewport.name, '予定', '.schedule-main', 'schedule');
    await auditSurface(page, home, viewport.name, '教材', '.bookshelf-view', 'bookshelf');
    await auditSurface(page, home, viewport.name, '時間割', '.timetable-view', 'timetable');

    await openPrimarySurface(page, 'ホーム');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await expectPersistentChrome(page);
    await page.waitForTimeout(250);
    const homeAgain = await readChromeMetrics(page);
    expectChromeToMatchHome(homeAgain, home);
  });
}
