import { expect, test } from '@playwright/test';

async function seedHome(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'ai-planning-attachment-mobile-user',
      email: 'ai-planning-attachment-mobile@example.com',
      username: 'ai-planning-attachment-mobile-user',
      avatar: '',
      createdAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function computedFontSize(locator) {
  return locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

async function addPreviewCardLayoutFixture(page) {
  await page.locator('.ai-planning-conversation').evaluate((conversation) => {
    if (conversation.querySelector('[data-testid="ai-preview-layout-fixture"]')) return;

    const previewCard = document.createElement('div');
    previewCard.className = 'ai-planning-plan-card';
    previewCard.dataset.testid = 'ai-preview-layout-fixture';
    previewCard.innerHTML = `
      <div class="ai-planning-plan-card-head">
        <div><span>計画案</span><strong>12件の予定を作成</strong></div>
        <b>12件</b>
      </div>
      <div class="ai-planning-plan-summary"><span>対象 8/27 - 9/7</span><span>合計 12時間</span></div>
      <button class="ai-planning-preview-button" type="button">計画プレビューを確認</button>
    `;
    conversation.appendChild(previewCard);
  });
}

async function expectPreviewCardCenteredAndContained(page) {
  const conversation = page.locator('.ai-planning-conversation');
  const previewCard = page.locator('[data-testid="ai-preview-layout-fixture"]');
  const [conversationBox, previewBox] = await Promise.all([
    conversation.boundingBox(),
    previewCard.boundingBox(),
  ]);

  expect(conversationBox).not.toBeNull();
  expect(previewBox).not.toBeNull();

  const conversationRight = conversationBox.x + conversationBox.width;
  const previewRight = previewBox.x + previewBox.width;
  const leftGap = previewBox.x - conversationBox.x;
  const rightGap = conversationRight - previewRight;

  expect(previewBox.x).toBeGreaterThanOrEqual(conversationBox.x - 1);
  expect(previewRight).toBeLessThanOrEqual(conversationRight + 1);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
}

async function expectComposerContained(page) {
  const card = page.locator('.ai-planning-card');
  const composer = page.locator('.ai-planning-composer');
  const mic = page.locator('.ai-planning-mic-button');
  const send = page.locator('.ai-planning-send-button');
  const [cardBox, composerBox, micBox, sendBox] = await Promise.all([
    card.boundingBox(),
    composer.boundingBox(),
    mic.boundingBox(),
    send.boundingBox(),
  ]);

  expect(cardBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(micBox).not.toBeNull();
  expect(sendBox).not.toBeNull();

  const cardRight = cardBox.x + cardBox.width;
  const composerRight = composerBox.x + composerBox.width;
  const micRight = micBox.x + micBox.width;
  const sendRight = sendBox.x + sendBox.width;

  expect(composerBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
  expect(composerRight).toBeLessThanOrEqual(cardRight + 1);
  expect(micRight).toBeLessThanOrEqual(composerRight + 1);
  expect(sendRight).toBeLessThanOrEqual(composerRight + 1);
  expect(sendRight).toBeLessThanOrEqual(cardRight + 1);

  const mobileLayout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.innerWidth + 1);
}

test('AI planning keeps preview and mobile actions contained and text inputs iOS-safe before focus', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await seedHome(page);
  await page.goto('/');
  await page.locator('.home-bottom-nav button').first().click();

  const attachmentButton = page.getByRole('button', { name: '写真を追加' });
  await expect(attachmentButton).toBeVisible();
  await expect(page.locator('.ai-planning-attachment-input')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg',
  );

  await expect(page.locator('.ai-planning-mic-button')).toBeVisible();
  await expect(page.locator('.ai-planning-send-button')).toBeVisible();
  await addPreviewCardLayoutFixture(page);

  for (const width of [360, 390, 402]) {
    await page.setViewportSize({ width, height: 844 });
    await expectPreviewCardCenteredAndContained(page);
    await expectComposerContained(page);
  }

  const composer = page.locator('.ai-planning-composer');
  const composerInput = composer.locator('textarea');
  expect(await computedFontSize(composerInput)).toBeGreaterThanOrEqual(16);
  await composerInput.focus();
  expect(await computedFontSize(composerInput)).toBeGreaterThanOrEqual(16);

  await composerInput.fill('明日の数学を1時間にして');
  await expect(composerInput).toHaveValue('明日の数学を1時間にして');
  await expectPreviewCardCenteredAndContained(page);
  await expectComposerContained(page);

  await page.getByRole('button', { name: 'チャット一覧を開く' }).click();
  const chatSearchInput = page.getByRole('searchbox', { name: 'チャットを検索' });
  await expect(chatSearchInput).toBeVisible();
  expect(await computedFontSize(chatSearchInput)).toBeGreaterThanOrEqual(16);
  await chatSearchInput.focus();
  expect(await computedFontSize(chatSearchInput)).toBeGreaterThanOrEqual(16);
});
