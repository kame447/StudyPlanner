import { expect, test as base } from '@playwright/test';

const installed = new WeakMap();

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

export async function installStartupSkipContext(context) {
  const registrations = [];
  const register = page => {
    const pending = installStartupSkip(page);
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
  context: async ({ context, skipStartupVideo }, use) => {
    const cleanup = skipStartupVideo ? await installStartupSkipContext(context) : async () => {};
    try { await use(context); } finally { await cleanup(); }
  },
  page: async ({ page, skipStartupVideo }, use) => {
    if (skipStartupVideo) await installStartupSkip(page);
    await use(page);
  },
});

export { expect };
