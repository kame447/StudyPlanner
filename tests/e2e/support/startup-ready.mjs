import { expect, test as base } from '@playwright/test';

const installed = new WeakMap();
const installedTutorial = new WeakMap();

// Ordinary screen tests take the same ready-only skip action as a user. Keep
// clocks, motion preferences and every downstream assertion unchanged. Movie
// tests opt out so they can observe the complete playback lifecycle.
export function installStartupSkip(page) {
  if (!installed.has(page)) {
    const skip = page.locator('button.startup-video:enabled[aria-label="起動アニメーションをスキップ"]');
    installed.set(page, page.addLocatorHandler(skip, async button => {
      await button.click();
    }).catch(error => {
      if (!page.isClosed()) throw error;
    }));
  }
  return installed.get(page);
}

// Other screen regressions skip the first-run product tour just as they skip
// startup playback. Dedicated onboarding tests opt out to exercise the tour itself.
export function installFirstRunTutorialSkip(page) {
  if (!installedTutorial.has(page)) {
    const skip = page.locator('main.first-run-tour button.first-run-tour-skip:enabled');
    installedTutorial.set(page, page.addLocatorHandler(skip, async button => {
      await button.click();
    }).catch(error => {
      if (!page.isClosed()) throw error;
    }));
  }
  return installedTutorial.get(page);
}

export async function installStartupSkipContext(context, { video = true, tutorial = true } = {}) {
  const registrations = [];
  const register = page => {
    const pending = Promise.all([
      ...(video ? [installStartupSkip(page)] : []),
      ...(tutorial ? [installFirstRunTutorialSkip(page)] : []),
    ]);
    registrations.push(pending);
    // Keep setup failures for the fixture teardown, without an unhandled
    // rejection while a separately created page is still being initialized.
    void pending.catch(() => {});
  };
  context.on('page', register);
  context.pages().forEach(register);
  await Promise.all(registrations);
  return async () => {
    context.off('page', register);
    await Promise.all(registrations);
  };
}

export const test = base.extend({
  skipStartupVideo: [true, { option: true }],
  skipFirstRunTutorial: [true, { option: true }],
  context: async ({ context, skipStartupVideo, skipFirstRunTutorial }, use) => {
    const cleanup = skipStartupVideo || skipFirstRunTutorial
      ? await installStartupSkipContext(context, { video: skipStartupVideo, tutorial: skipFirstRunTutorial })
      : async () => {};
    try { await use(context); } finally { await cleanup(); }
  },
  page: async ({ page, skipStartupVideo, skipFirstRunTutorial }, use) => {
    if (skipStartupVideo) await installStartupSkip(page);
    if (skipFirstRunTutorial) await installFirstRunTutorialSkip(page);
    await use(page);
  },
});

export { expect };
