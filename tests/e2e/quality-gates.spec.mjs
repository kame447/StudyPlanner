import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  clickPrimaryNav,
  readDocumentBounds,
  seedRegressionUser,
  waitForVisualReady,
} from './support/ui-regression.mjs';

const APP_ORIGIN = 'http://127.0.0.1:4173';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);
const VIEWPORTS = [
  { name: 'small-mobile', width: 360, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'compact-desktop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
];
const SURFACES = [
  { name: 'home', selector: '.home-main > .home-dashboard' },
  { name: 'bookshelf', selector: '.bookshelf-view', nav: '教材' },
  { name: 'schedule', selector: '.schedule-workspace-shell', nav: '予定' },
  { name: 'ai-planning', selector: '.ai-planning-card', nav: 'AI計画' },
];

async function openSurface(page, surface) {
  if (surface.nav) {
    await clickPrimaryNav(page, surface.nav);
  }
  await waitForVisualReady(page, surface.selector);
  await expect(page.locator(surface.selector).first()).toBeVisible();
}

function summarizeViolations(violations) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .slice(0, 4)
        .flatMap((node) => node.target)
        .join(', ');
      return `${violation.id} [${violation.impact ?? 'unknown'}] ${violation.help} :: ${targets}`;
    })
    .join('\n');
}

for (const theme of ['light', 'dark']) {
  test(`${theme} primary surfaces have no serious or critical automated WCAG 2.2 violations`, async ({ page }, testInfo) => {
    await seedRegressionUser(page, { theme });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    for (const surface of SURFACES) {
      await openSurface(page, surface);
      const scan = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      await testInfo.attach(`axe-${theme}-${surface.name}`, {
        body: Buffer.from(JSON.stringify(scan, null, 2)),
        contentType: 'application/json',
      });
      const blocking = scan.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact));
      expect(blocking, summarizeViolations(blocking)).toEqual([]);
    }
  });

  test(`${theme} primary surfaces stay horizontally contained at supported viewport boundaries`, async ({ page }) => {
    await seedRegressionUser(page, { theme });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      for (const surface of SURFACES) {
        await openSurface(page, surface);
        const bounds = await readDocumentBounds(page);
        expect(
          bounds.scrollWidth,
          `${surface.name} overflows horizontally at ${viewport.name} (${viewport.width}px)`,
        ).toBeLessThanOrEqual(bounds.viewportWidth + 1);
      }
    }
  });
}

test('primary navigation has no uncaught errors, same-origin request failures, 5xx responses, or console errors', async ({ page }, testInfo) => {
  const pageErrors = [];
  const requestFailures = [];
  const serverErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    try {
      if (new URL(request.url()).origin === APP_ORIGIN) {
        requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`);
      }
    } catch {
      // Ignore malformed third-party URLs. They are outside the application origin contract.
    }
  });
  page.on('response', (response) => {
    try {
      if (new URL(response.url()).origin === APP_ORIGIN && response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    } catch {
      // Ignore malformed third-party URLs. They are outside the application origin contract.
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await seedRegressionUser(page, { theme: 'light' });
  await page.goto('/');
  for (const surface of SURFACES) {
    await openSurface(page, surface);
  }

  const diagnostics = { pageErrors, requestFailures, serverErrors, consoleErrors };
  await testInfo.attach('runtime-health', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: 'application/json',
  });

  expect(pageErrors).toEqual([]);
  expect(requestFailures).toEqual([]);
  expect(serverErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
