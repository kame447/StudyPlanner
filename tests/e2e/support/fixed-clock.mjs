import { expect, test as base } from '@playwright/test';

// Browser Regression seeds build "today" and plan times from the clock. The app
// resolves "today" from the browser clock in the browser timezone, so a live
// runner clock makes seeds drift across the local date boundary (and across the
// evening, when fixed-time plans are no longer upcoming). Every date-dependent
// spec imports `test` from here: the browser runs in E2E_TIMEZONE with a clock
// installed at E2E_FIXED_NOW that keeps flowing so timers still advance, and
// runner-side seeds use E2E_TODAY instead of the Node clock.
export const E2E_TIMEZONE = 'Asia/Tokyo';
export const E2E_FIXED_NOW = new Date('2026-08-19T10:00:00+09:00');
export const E2E_TODAY = '2026-08-19';

async function installFixedClock(context) {
  await context.clock.install({ time: E2E_FIXED_NOW });
}

export const test = base.extend({
  timezoneId: [E2E_TIMEZONE, { option: true }],
  context: async ({ context }, use) => {
    await installFixedClock(context);
    await use(context);
  },
});

// For specs that open their own context (e.g. touch-enabled mobile contexts).
export async function newFixedClockContext(browser, options = {}) {
  const context = await browser.newContext({ timezoneId: E2E_TIMEZONE, ...options });
  await installFixedClock(context);
  return context;
}

export { expect };
