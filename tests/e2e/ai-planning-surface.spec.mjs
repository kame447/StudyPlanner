import { expect, test } from '@playwright/test';

async function seedHome(page) {
  await page.addInitScript(() => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'ai-planning-surface-user',
      email: 'ai-planning-surface@example.com',
      username: 'ai-planning-surface-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'ai-planning-surface-plan',
      seriesId: 'ai-planning-surface-plan',
      userId: user.id,
      title: '情報資源総論',
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: '10:20',
      endTime: '11:50',
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
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function seedMultiweekDraftPlan(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const today = new Date();
    const user = {
      id: 'ai-planning-multiweek-user',
      email: 'ai-planning-multiweek@example.com',
      username: 'ai-planning-multiweek-user',
      avatar: '',
      createdAt: now,
    };
    const toIsoDate = (value) => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const addDays = (value, amount) => {
      const next = new Date(value);
      next.setDate(next.getDate() + amount);
      return next;
    };
    const monday = new Date(today);
    const weekday = monday.getDay();
    monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
    const weekStartDate = toIsoDate(monday);
    const draftBlocks = Array.from({ length: 12 }, (_, index) => ({
      id: `gold-${index + 1}`,
      userId: user.id,
      date: toIsoDate(addDays(today, index + 1)),
      startTime: '19:00',
      endTime: '20:00',
      title: '金フレ',
      subject: 'TOEIC',
      type: 'study',
      label: '金フレ',
      source: 'ai',
      status: 'draft',
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    }));
    const previewCandidates = draftBlocks.map((block, index) => ({
      stableKey: block.id,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      durationMinutes: 60,
      title: block.title,
      field: block.subject,
      year: index + 1,
      estimatedMinutes: 60,
      source: 'weekly_exam_prep',
      approvalStatus: 'unapproved',
      workItemKey: 'gold-phrase',
    }));
    const planningState = {
      weekStartDate,
      revision: 1,
      conversationRequestSequence: 0,
      mode: 'draft_created',
      draftBlocks,
      previewCandidates,
      messages: [],
      updatedAt: now,
    };
    const storageKey = `studyplanner.weeklyPlanning.${user.id}.${weekStartDate}`;

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 3,
        ownerId: user.id,
        payload: { version: 2, state: planningState },
      }),
    );
    localStorage.setItem(
      `studyplanner.weeklyPlanning.activeSession.${user.id}`,
      JSON.stringify({
        version: 1,
        ownerId: user.id,
        weekStartDate,
        conversationId: null,
      }),
    );
  });
}

test('home AI planning entry opens the dedicated Stable V5 conversation surface', async ({ page }) => {
  await seedHome(page);
  await page.goto('/');
  await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();

  const homeTopbarBox = await page.locator('.home-topbar').boundingBox();
  const homeNavBox = await page.locator('.primary-bottom-nav').boundingBox();

  await page.locator('.primary-bottom-nav button').first().click();

  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expect(page.locator('.ai-planning-heading h1')).toHaveText('AI計画');
  await expect(page.locator('.ai-planning-conversation')).toBeVisible();
  await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();
  await expect(page.getByRole('button', { name: '写真を追加' })).toBeVisible();
  await expect(page.locator('.ai-planning-attachment-input')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg',
  );
  await expect(page.locator('.quick-entry-modal')).toHaveCount(0);
  await expect(page.locator('.ai-planning-view .segmented-control')).toHaveCount(0);
  await expect(page.getByText('相談', { exact: true })).toHaveCount(0);
  await expect(page.getByText('週間計画', { exact: true })).toHaveCount(0);
  await expect(page.getByText('こんにちは。今週の目標や予定に合わせて、学習計画を作成します。')).toHaveCount(0);
  await expect(page.locator('.ai-planning-starter-list button')).toHaveCount(3);

  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2m5QAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('.ai-planning-attachment-input').setInputFiles({
    name: 'test-range.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await expect(page.locator('.ai-planning-attachment-preview')).toBeVisible();
  await expect(page.locator('.ai-planning-attachment-preview')).toContainText('test-range.png');
  await page.getByRole('button', { name: '添付画像を削除' }).click();
  await expect(page.locator('.ai-planning-attachment-preview')).toHaveCount(0);

  const aiNavBox = await page.locator('.primary-bottom-nav').boundingBox();
  expect(aiNavBox?.width).toBeCloseTo(homeNavBox?.width ?? 0, 0);
  expect(aiNavBox?.height).toBeCloseTo(homeNavBox?.height ?? 0, 0);

  const aiSurfaceBox = await page.locator('.ai-planning-view').boundingBox();
  expect(aiSurfaceBox?.y).toBeGreaterThanOrEqual((homeTopbarBox?.y ?? 0) + (homeTopbarBox?.height ?? 0));

  await page.locator('.ai-planning-chat-menu-button').click();
  await expect(page.locator('.ai-chat-drawer')).toBeVisible();
  await expect(page.locator('.ai-chat-row')).toHaveCount(1);
  await page.locator('.ai-chat-new-button').click();
  await page.locator('.ai-planning-chat-menu-button').click();
  await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  await page.locator('.ai-chat-search input').fill('新しい');
  await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  await page.locator('.ai-chat-drawer-header button').click();

  await page.locator('.home-top-actions .home-icon-button').last().click();
  await expect(page.locator('.app-settings-overlay')).toBeVisible();
  const stacking = await page.evaluate(() => {
    const zIndexOf = (element) => {
      if (!(element instanceof Element)) return 0;
      return Number.parseInt(getComputedStyle(element).zIndex, 10) || 0;
    };
    return {
      ai: zIndexOf(document.querySelector('.ai-planning-view')),
      modal: zIndexOf(document.querySelector('.app-settings-overlay')),
    };
  });
  expect(stacking.modal).toBeGreaterThan(stacking.ai);
  await page.locator('.app-settings-modal .ghost-button').first().click();

  await page.locator('.home-avatar-button').click();
  await expect(page.locator('.my-page-modal')).toBeVisible();
  const profileStacking = await page.evaluate(() => {
    const zIndexOf = (element) => {
      if (!(element instanceof Element)) return 0;
      return Number.parseInt(getComputedStyle(element).zIndex, 10) || 0;
    };
    return {
      ai: zIndexOf(document.querySelector('.ai-planning-view')),
      modal: zIndexOf(document.querySelector('.my-page-modal')?.parentElement),
    };
  });
  expect(profileStacking.modal).toBeGreaterThan(profileStacking.ai);
  await page.locator('.my-page-modal .ghost-button').first().click();

  await page.locator('.primary-bottom-nav button').nth(2).click();
  await expect(page.locator('.ai-planning-view')).toHaveCount(0);
  await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
});

test('multiweek AI plan keeps full totals, pages the timeline, and promotes every day on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMultiweekDraftPlan(page);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();

  const planCard = page.locator('.ai-planning-plan-card');
  await expect(planCard).toBeVisible();
  await expect(planCard).toContainText('12件の予定を作成');
  await expect(planCard).toContainText('合計 12時間');
  await expect(planCard).not.toContainText('今週の計画案');

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-preview-header')).toContainText('12件');
  await expect(preview.locator('.ai-planning-preview-period-nav')).toContainText('1 / 2');
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(7);
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(7);

  const previousButton = preview.getByRole('button', { name: '前の期間を表示' });
  const nextButton = preview.getByRole('button', { name: '次の期間を表示' });
  await expect(previousButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();
  await nextButton.click();

  await expect(preview.locator('.ai-planning-preview-period-nav')).toContainText('2 / 2');
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(5);
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(5);
  await expect(previousButton).toBeEnabled();
  await expect(nextButton).toBeDisabled();

  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(preview.locator('.ai-planning-preview-header')).toContainText('12件');
  await expect(planCard).toContainText('12件の予定を作成');
  await expect(preview.getByRole('button', { name: 'この内容で保存' })).toBeVisible();

  const previewBox = await preview.boundingBox();
  expect(previewBox?.width ?? 0).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: 'artifacts/ai-planning-multiweek-preview-mobile.png',
    fullPage: true,
  });
});
