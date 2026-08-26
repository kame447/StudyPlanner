import { expect, test } from '@playwright/test';
import {
  clickPrimaryNav,
  readDocumentBounds,
  seedRegressionUser,
} from './support/ui-regression.mjs';

async function expectNoHorizontalOverflow(page) {
  const bounds = await readDocumentBounds(page);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth + 1);
}

async function expectSurface(page, selector) {
  await expect(page.locator(selector).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
}

async function addAiPlanningPreviewLayoutFixture(page) {
  await page.locator('.ai-planning-conversation').evaluate((conversation) => {
    if (conversation.querySelector('[data-testid="cross-browser-ai-plan"]')) return;

    const planCard = document.createElement('div');
    planCard.className = 'ai-planning-plan-card';
    planCard.dataset.testid = 'cross-browser-ai-plan';
    planCard.innerHTML = `
      <div class="ai-planning-plan-card-head">
        <div>
          <span>計画案</span>
          <strong>12件の予定を作成</strong>
        </div>
        <b>12件</b>
      </div>
      <div class="ai-planning-plan-summary">
        <span>対象 8/27 木 - 9/7 月</span>
        <span>合計 12時間</span>
      </div>
      <button class="ai-planning-preview-button" type="button">
        <span>計画プレビューを確認</span>
      </button>
    `;
    conversation.appendChild(planCard);
  });
}

async function expectAiPlanningContainment(page) {
  const metrics = await page.evaluate(() => {
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      return element;
    };
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };

    const surface = required('.ai-planning-card');
    const conversation = required('.ai-planning-conversation');
    const plan = required('[data-testid="cross-browser-ai-plan"]');
    const badge = required('[data-testid="cross-browser-ai-plan"] .ai-planning-plan-card-head b');
    const previewButton = required('[data-testid="cross-browser-ai-plan"] .ai-planning-preview-button');
    const composer = required('.ai-planning-composer');
    const send = required('.ai-planning-send-button');
    const conversationRect = conversation.getBoundingClientRect();
    const conversationStyle = getComputedStyle(conversation);
    const contentLeft =
      conversationRect.left + Number.parseFloat(conversationStyle.paddingLeft);
    const contentRight =
      conversationRect.left +
      conversation.clientWidth -
      Number.parseFloat(conversationStyle.paddingRight);
    const planRect = plan.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      surface: box(surface),
      conversation: box(conversation),
      plan: box(plan),
      badge: box(badge),
      previewButton: box(previewButton),
      composer: box(composer),
      send: box(send),
      planLeftGap: planRect.left - contentLeft,
      planRightGap: contentRight - planRect.right,
    };
  });

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.conversation.scrollWidth).toBeLessThanOrEqual(
    metrics.conversation.clientWidth + 1,
  );
  expect(metrics.plan.scrollWidth).toBeLessThanOrEqual(metrics.plan.clientWidth + 1);
  expect(metrics.composer.scrollWidth).toBeLessThanOrEqual(metrics.composer.clientWidth + 1);

  expect(metrics.plan.left).toBeGreaterThanOrEqual(metrics.surface.left - 1);
  expect(metrics.plan.right).toBeLessThanOrEqual(metrics.surface.right + 1);
  expect(metrics.badge.right).toBeLessThanOrEqual(metrics.plan.right + 1);
  expect(metrics.previewButton.right).toBeLessThanOrEqual(metrics.plan.right + 1);
  expect(metrics.composer.left).toBeGreaterThanOrEqual(metrics.surface.left - 1);
  expect(metrics.composer.right).toBeLessThanOrEqual(metrics.surface.right + 1);
  expect(metrics.send.right).toBeLessThanOrEqual(metrics.composer.right + 1);
  expect(Math.abs(metrics.planLeftGap - metrics.planRightGap)).toBeLessThanOrEqual(2);
}

for (const theme of ['light', 'dark']) {
  test(`${theme} primary navigation remains operable across the browser engine`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await seedRegressionUser(page, { theme });
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectSurface(page, '.home-main > .home-dashboard');

    await clickPrimaryNav(page, '教材');
    await expectSurface(page, '.bookshelf-view');

    await clickPrimaryNav(page, '予定');
    await expectSurface(page, '.schedule-workspace-shell');

    await clickPrimaryNav(page, 'AI計画');
    await expectSurface(page, '.ai-planning-card');
    await addAiPlanningPreviewLayoutFixture(page);
    await expectAiPlanningContainment(page);

    expect(pageErrors).toEqual([]);
  });
}
