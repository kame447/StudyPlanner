import { expect, test } from './support/fixed-clock.mjs';
import { clickPrimaryNav, seedRegressionUser } from './support/ui-regression.mjs';

// Desktop automation cannot open an iOS keyboard. Simulate its VisualViewport
// boundary while keeping the full App, persisted messages and DOM layout real.
// Actual Safari keyboard/pinch interaction remains a separate device check.
async function seedConversationAndViewport(page, withPreview = false) {
  await seedRegressionUser(page);
  const initialViewport = page.viewportSize();
  if (!initialViewport) throw new Error('The visual-viewport fixture requires an explicit browser viewport');
  await page.addInitScript(({ withPreview, viewportHeight }) => {
    const viewport = window.visualViewport;
    // Init scripts run before the viewport meta tag. Mobile innerHeight can
    // still describe the default 980px layout viewport here, not the configured
    // device viewport. Use the runner's size until the test explicitly resizes.
    const metrics = { height: viewportHeight, offsetTop: 0, scale: 1 };
    for (const key of Object.keys(metrics)) {
      Object.defineProperty(viewport, key, { configurable: true, get: () => metrics[key] });
    }
    window.__aiComposerViewport = {
      set(next, event = 'resize') {
        Object.assign(metrics, next);
        viewport.dispatchEvent(new Event(event));
      },
    };
    const ownerId = 'ui-regression-user';
    const weekStartDate = '2026-08-17';
    const now = new Date().toISOString();
    const messages = Array.from({ length: 24 }, (_, index) => ({
      id: `viewport-message-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `会話履歴 ${index + 1}。入力中もこれまでの相談を読み返せます。`,
      createdAt: now,
    }));
    const draftBlocks = withPreview ? [{
      id: 'viewport-preview', userId: ownerId, date: '2026-08-19',
      startTime: '09:00', endTime: '10:00', title: 'プレビュー確認', subject: '数学',
      type: 'study', label: '数学', source: 'ai', status: 'draft', userEdited: false,
      createdAt: now, updatedAt: now,
    }] : [];
    localStorage.setItem(`studyplanner.weeklyPlanning.${ownerId}.${weekStartDate}`, JSON.stringify({
      version: 3, ownerId,
      payload: { version: 2, state: {
        weekStartDate, revision: 1, conversationRequestSequence: 0,
        mode: withPreview ? 'draft_created' : 'collecting_tasks',
        draftBlocks, previewCandidates: [], messages, updatedAt: now,
      } },
    }));
    localStorage.setItem(`studyplanner.weeklyPlanning.activeSession.${ownerId}`, JSON.stringify({
      version: 1, ownerId, weekStartDate, conversationId: null,
    }));
  }, { withPreview, viewportHeight: initialViewport.height });
}

async function changeViewport(page, metrics, event = 'resize') {
  await page.evaluate(({ metrics, event }) => window.__aiComposerViewport.set(metrics, event), { metrics, event });
}

async function scrollConversationToStart(page, conversation, { browserName, isMobile }) {
  await expect(conversation).toHaveCSS('overflow-y', 'auto');
  expect(await conversation.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  if (browserName === 'webkit' && isMobile) {
    // Playwright mobile WebKit does not support mouse.wheel. Establish the
    // reader-position boundary directly, then exercise the real DOM/layout
    // retention checks below. Chromium still verifies the native wheel path;
    // neither this nor the viewport fixture substitutes for an iOS touch test.
    await conversation.evaluate(element => { element.scrollTop = 0; });
  } else {
    const rect = await conversation.boundingBox();
    if (!rect) throw new Error('Conversation scroll surface is not measurable');
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, -10000);
  }
  await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBe(0);
}

async function readLayout(page) {
  return page.evaluate(() => {
    const conversation = document.querySelector('.ai-planning-conversation');
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    return {
      top: visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height,
      shell: box('.app-shell'), conversation: box('.ai-planning-conversation'),
      composer: box('.ai-planning-composer'), send: box('.ai-planning-send-button'),
      nav: box('.primary-bottom-nav'), scrollTop: conversation.scrollTop,
      endGap: conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop,
      windowScroll: window.scrollY,
    };
  });
}

async function expectReadableLayout(page) {
  await expect.poll(async () => {
    const layout = await readLayout(page);
    return layout.conversation.height;
  }).toBeGreaterThan(80);
  const layout = await readLayout(page);
  expect(layout.shell.top).toBeGreaterThanOrEqual(layout.top - 1);
  expect(layout.shell.bottom).toBeLessThanOrEqual(layout.bottom + 1);
  expect(layout.conversation.top).toBeGreaterThanOrEqual(layout.top);
  expect(layout.conversation.bottom).toBeLessThanOrEqual(layout.composer.top + 1);
  expect(layout.composer.bottom).toBeLessThanOrEqual(layout.nav.top + 1);
  expect(layout.send.top).toBeGreaterThanOrEqual(layout.top);
  expect(layout.send.bottom).toBeLessThanOrEqual(layout.bottom);
  expect(layout.nav.bottom).toBeLessThanOrEqual(layout.bottom + 1);
}

test.describe('AI conversation stays readable with a reduced visual viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const { width, height, keyboardHeight } of [
    { width: 360, height: 640, keyboardHeight: 400 },
    { width: 390, height: 844, keyboardHeight: 460 },
    { width: 402, height: 874, keyboardHeight: 480 },
  ]) {
    test(`keeps history and composer visible during keyboard resize/pan at ${width}px`, async ({ page, browserName, isMobile }, testInfo) => {
      await page.setViewportSize({ width, height });
      await seedConversationAndViewport(page);
      await page.goto('/');
      await clickPrimaryNav(page, 'AI計画');
      const input = page.locator('.ai-planning-composer textarea');
      const conversation = page.locator('.ai-planning-conversation');
      const messages = conversation.locator('.ai-planning-message-row');
      await expect(messages).toHaveCount(24);
      await expect(input).not.toBeFocused();
      const initial = await readLayout(page);
      expect(initial.shell.height).toBe(height);
      await expectReadableLayout(page);
      await expect.poll(async () => (await readLayout(page)).endGap).toBeLessThanOrEqual(2);

      await input.tap();
      await expect(input).toBeFocused();
      await changeViewport(page, { height: keyboardHeight, offsetTop: 76 });
      await input.fill('前の相談を確認しながら入力\n2行目も保持');
      await expectReadableLayout(page);
      await expect.poll(async () => (await readLayout(page)).endGap).toBeLessThanOrEqual(2);
      await expect(messages.last()).toBeInViewport();
      await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
      const screenshotPath = testInfo.outputPath(`ai-composer-keyboard-${width}.png`);
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach(`ai-composer-keyboard-${width}`, {
        path: screenshotPath, contentType: 'image/png',
      });

      // Scroll old messages while input remains focused. Neither typing nor
      // visual-viewport panning may put the user back at the conversation end.
      await scrollConversationToStart(page, conversation, { browserName, isMobile });
      await expect.poll(async () => (await readLayout(page)).scrollTop).toBe(0);
      await expect(input).toBeFocused();
      await expect(messages.first()).toBeInViewport();
      await changeViewport(page, { offsetTop: 110 }, 'scroll');
      await input.press('End');
      await input.press('a');
      expect((await readLayout(page)).scrollTop).toBe(0);
      await expect(messages.first()).toBeInViewport();
      await expectReadableLayout(page);
      await expect(messages).toHaveCount(24);

      // Dismissal restores full layout, including navigation, without losing
      // the draft or the reader position. Repeat to catch retained listeners.
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await input.evaluate(element => element.blur());
        await changeViewport(page, { height, offsetTop: 0 });
        await expect(input).not.toBeFocused();
        await expectReadableLayout(page);
        expect((await readLayout(page)).scrollTop).toBe(0);
        await input.tap();
        await changeViewport(page, { height: keyboardHeight, offsetTop: 76 });
        await expectReadableLayout(page);
      }
      await expect(input).toHaveValue('前の相談を確認しながら入力\n2行目も保持a');
      expect((await readLayout(page)).windowScroll).toBe(initial.windowScroll);

      await input.evaluate(element => element.blur());
      await changeViewport(page, { height, offsetTop: 0 });
      await clickPrimaryNav(page, 'ホーム');
      await expect(page.locator('.ai-planning-view')).toHaveCount(0);
      expect(await page.locator('.app-shell').evaluate(element => ({
        height: element.style.getPropertyValue('--ai-planning-viewport-height'),
        top: element.style.getPropertyValue('--ai-planning-viewport-top'),
      }))).toEqual({ height: '', top: '' });
      await clickPrimaryNav(page, 'AI計画');
      await expect(messages).toHaveCount(24);
      await expect(input).not.toBeFocused();
      await expectReadableLayout(page);
    });
  }

  test('does not reflow the chat during pinch zoom and restores geometry afterward', async ({ page }) => {
    await seedConversationAndViewport(page); await page.goto('/');
    await clickPrimaryNav(page, 'AI計画');
    await expect(page.locator('.ai-planning-message-row')).toHaveCount(24);
    const original = (await readLayout(page)).shell;
    await changeViewport(page, { scale: 1.5, height: 560, offsetTop: 160 });
    expect((await readLayout(page)).shell).toEqual(original);
    await changeViewport(page, { offsetTop: 220 }, 'scroll');
    expect((await readLayout(page)).shell).toEqual(original);
    await changeViewport(page, { scale: 1, height: 844, offsetTop: 0 });
    await expectReadableLayout(page);
  });

  test('respects the preview scroll lock while the viewport changes and releases both owners on close', async ({ page, browserName, isMobile }) => {
    await seedConversationAndViewport(page, true); await page.goto('/');
    await clickPrimaryNav(page, 'AI計画');
    await expect(page.locator('.ai-planning-message-row')).toHaveCount(24);
    await page.getByRole('button', { name: '計画プレビューを確認' }).click();
    const preview = page.getByRole('dialog', { name: '計画プレビュー' });
    await expect(preview).toBeVisible();
    const conversation = page.locator('.ai-planning-conversation');
    const pinnedTop = await conversation.evaluate(element => element.scrollTop);
    await changeViewport(page, { height: 460, offsetTop: 80 });
    await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBe(pinnedTop);
    await changeViewport(page, { offsetTop: 100 }, 'scroll');
    await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBe(pinnedTop);
    await changeViewport(page, { height: 844, offsetTop: 0 });
    await preview.getByRole('button', { name: '閉じる' }).click();
    await expect(preview).toBeHidden();
    await expect(conversation).toHaveCSS('overflow-y', 'auto');
    expect(await page.evaluate(() => ({
      root: document.documentElement.style.overflow,
      body: document.body.style.overflow, position: document.body.style.position,
    }))).toEqual({ root: '', body: '', position: '' });
    await expect(page.locator('.ai-planning-composer textarea')).not.toBeFocused();
    await expectReadableLayout(page);
    await scrollConversationToStart(page, conversation, { browserName, isMobile });
    await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBe(0);
    await expect(conversation.locator('.ai-planning-message-row').first()).toBeInViewport();
  });

});

test.describe('AI composer on desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test('keeps desktop geometry and keyboard navigation intact', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedConversationAndViewport(page); await page.goto('/');
    await clickPrimaryNav(page, 'AI計画');
    const input = page.locator('.ai-planning-composer textarea');
    await expect(input).not.toBeFocused();
    await input.click();
    await input.fill('入力途中');
    await input.press('Shift+Enter');
    await input.press('a');
    await expect(input).toHaveValue('入力途中\na');
    await input.press('Tab');
    await expect(page.getByRole('button', { name: '音声入力', exact: true })).toBeFocused();
    await expectReadableLayout(page);
  });
});
