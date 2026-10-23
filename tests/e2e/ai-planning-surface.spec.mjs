import { expect, test } from './support/fixed-clock.mjs';
import { waitForVisualReady } from './support/ui-regression.mjs';

async function seedHome(page) {
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('sv-SE');
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

async function seedMultiweekDraftPlan(page, dayCount = 12, messageCount = 0) {
  await page.addInitScript(({ dayCount: requestedDayCount, messageCount: requestedMessageCount }) => {
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
    const draftBlocks = Array.from({ length: requestedDayCount }, (_, index) => ({
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
      messages: Array.from({ length: requestedMessageCount }, (_, index) => ({
        id: `desktop-message-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `学習計画についての相談 ${index + 1}。予定を確認しながら無理のない学習時間を考えます。`,
        createdAt: now,
      })),
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
  }, { dayCount, messageCount });
}

test('home AI planning entry opens the dedicated Stable V5 conversation surface', async ({ page }) => {
  await seedHome(page);
  await page.goto('/');
  await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
  const homeViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  // Desktop intentionally skips the compact vertical-fit lock.
  await expect.poll(() => page.locator('.primary-app-header').getAttribute('data-home-chrome-viewport'))
    .toBe(homeViewport.width >= 1200 ? null : `${homeViewport.width}x${homeViewport.height}`);
  await waitForVisualReady(page, '.home-main > .home-dashboard-default');

  const homeTopbarBox = await page.locator('.home-topbar').boundingBox();
  const homeNavBox = await page.locator('.primary-bottom-nav').boundingBox();
  const homeContentBox = await page.locator('.home-main > .home-dashboard-default').boundingBox();
  const expectInactiveAiSurface = async () => {
    const ai = page.locator('.ai-planning-view');
    await expect(ai).toHaveCount(1);
    await expect(ai).toBeHidden();
    await expect(page.getByRole('region', { name: 'AI計画', exact: true })).toHaveCount(0);
    expect(await ai.boundingBox()).toBeNull();
    await expect(page.locator('.app-shell')).not.toHaveCSS('position', 'fixed');
    expect(await page.locator('.app-shell').evaluate(element => ({
      height: element.style.getPropertyValue('--ai-planning-viewport-height'),
      top: element.style.getPropertyValue('--ai-planning-viewport-top'),
    }))).toEqual({ height: '', top: '' });
  };

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
  await expect(page.locator('.app-settings-page')).toBeVisible();
  await expectInactiveAiSurface();
  await expect(page.locator('.primary-bottom-nav')).toBeHidden();
  await page.goBack();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await page.goForward();
  await expect(page.locator('.app-settings-page')).toBeVisible();
  await expectInactiveAiSurface();
  await page.locator('.app-settings-page').getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();

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
  await expectInactiveAiSurface();
  await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
  await expect(async () => {
    const returnedHomeBox = await page.locator('.home-main > .home-dashboard-default').boundingBox();
    for (const dimension of ['x', 'y', 'width', 'height']) {
      expect(returnedHomeBox?.[dimension]).toBeCloseTo(homeContentBox?.[dimension] ?? 0, 0);
    }
  }).toPass({ timeout: 5000 });
  await expect(page.locator('.primary-bottom-nav button').nth(2)).toHaveAttribute('aria-current', 'page');
  // Real clicks must reach Home/settings rather than the retained hidden layer.
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await expect(page.locator('.app-settings-page')).toBeVisible();
  await expectInactiveAiSurface();
  await page.locator('.app-settings-page').getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
  await expectInactiveAiSurface();
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

test('month-long AI plan stays intact across five seven-day preview pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMultiweekDraftPlan(page, 31);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();

  const planCard = page.locator('.ai-planning-plan-card');
  await expect(planCard).toBeVisible();
  await expect(planCard).toContainText('31件の予定を作成');
  await expect(planCard).toContainText('合計 31時間');

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  const nextButton = preview.getByRole('button', { name: '次の期間を表示' });

  await expect(preview.locator('.ai-planning-preview-header')).toContainText('31件');
  await expect(preview.locator('.ai-planning-preview-period-nav')).toContainText('1 / 5');
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(7);
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(7);

  for (let pageNumber = 2; pageNumber <= 5; pageNumber += 1) {
    await nextButton.click();
    await expect(preview.locator('.ai-planning-preview-period-nav'))
      .toContainText(`${pageNumber} / 5`);
    await expect(preview.locator('.ai-planning-draft-block'))
      .toHaveCount(pageNumber === 5 ? 3 : 7);
  }

  await expect(nextButton).toBeDisabled();
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(3);

  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(preview.locator('.ai-planning-preview-header')).toContainText('31件');
  await expect(planCard).toContainText('31件の予定を作成');
  await expect(preview.getByRole('button', { name: 'この内容で保存' })).toBeVisible();
});

async function captureDesktopGeometry(page, testInfo, stage, selectors) {
  const geometry = await page.evaluate((selected) => {
    const elements = Object.fromEntries(Object.entries(selected).map(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element) return [name, null];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [name, {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        scrollTop: element.scrollTop, overflowY: style.overflowY, display: style.display,
        fontSize: Number.parseFloat(style.fontSize),
      }];
    }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio, userAgent: navigator.userAgent, fonts: document.fonts.status,
      theme: document.documentElement.dataset.theme,
      document: { width: document.documentElement.scrollWidth, x: scrollX, y: scrollY },
      elements,
    };
  }, selectors);
  await testInfo.attach(`${stage}-geometry`, {
    body: JSON.stringify({ revision: process.env.GITHUB_SHA ?? null, project: testInfo.project.name, ...geometry }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach(`${stage}-screenshot`, {
    body: await page.screenshot(), contentType: 'image/png',
  });
  return geometry;
}

async function expectPreviewContrast(page, testInfo, stage) {
  const root = stage.endsWith('card') ? '.ai-planning-plan-card' : '.ai-planning-preview-dialog-v2';
  const samples = await page.locator(root).evaluate((dialog, selectedStage) => {
    const rgb = value => {
      const match = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
      if (!match) throw new Error(`Unsupported computed color: ${value}`);
      const channels = match.slice(1, 4).map(Number);
      const alpha = match[4] === undefined ? 1 : Number(match[4]);
      if (channels.some(channel => channel < 0 || channel > 255) || alpha < 0 || alpha > 1) throw new Error(`Invalid computed color: ${value}`);
      return [...channels, alpha];
    };
    const over = (front, back) => front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3]));
    const luminance = color => color.map(channel => {
      const v = channel / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const cardTargets = ['.ai-planning-preview-button', '.ai-planning-plan-card-head b'];
    const lightPrimaryOnly = selectedStage.endsWith('light-primary');
    const selectors = lightPrimaryOnly ? ['.ai-planning-primary-action'] : selectedStage.endsWith('card') ? cardTargets : [
      '.ai-planning-preview-header h2', '.ai-planning-preview-header p',
      '.ai-planning-week-header strong', '.ai-planning-week-header small',
      '.ai-planning-preview-period-nav strong', '.ai-planning-preview-period-nav small',
      '.ai-planning-preview-hint', '.ai-planning-time-axis span',
      '.ai-planning-preview-day-nav strong', '.ai-planning-preview-day-nav small',
      '.ai-planning-preview-day-axis > span', '.ai-planning-preview-detail-block strong',
      '.ai-planning-preview-detail-block small', '.ai-planning-primary-action', '.ai-planning-secondary-action',
    ];
    const required = lightPrimaryOnly ? ['.ai-planning-primary-action'] : selectedStage.endsWith('card') ? cardTargets : ['.ai-planning-preview-header h2', '.ai-planning-preview-header p', '.ai-planning-primary-action', '.ai-planning-secondary-action',
      ...(selectedStage.endsWith('overview')
        ? ['.ai-planning-week-header strong', '.ai-planning-week-header small', '.ai-planning-preview-period-nav strong', '.ai-planning-preview-hint', '.ai-planning-time-axis span']
        : ['.ai-planning-preview-day-nav strong', '.ai-planning-preview-day-nav small', '.ai-planning-preview-day-axis > span', '.ai-planning-preview-detail-block strong', '.ai-planning-preview-detail-block small'])];
    for (const selector of required) if (!dialog.querySelector(selector)) throw new Error(`Missing contrast target: ${selector}`);
    return selectors.flatMap(selector => [...dialog.querySelectorAll(selector)].map(element => {
      const style = getComputedStyle(element);
      const layers = [];
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (lightPrimaryOnly && ancestorStyle.backgroundImage !== 'none') throw new Error('Unsupported light confirmation background image');
        layers.push(rgb(ancestorStyle.backgroundColor));
        if (layers.at(-1)[3] === 1) break;
      }
      if (lightPrimaryOnly && layers.at(-1)?.[3] !== 1) throw new Error('Light confirmation requires an opaque background');
      // White is a conservative backing for pale text on these dark, translucent
      // token surfaces. This does not claim to sample arbitrary page gradients.
      const background = layers.reverse().reduce((back, layer) => over(layer, back), [255, 255, 255]);
      const foreground = over(rgb(style.color), background);
      const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      return { selector, text: element.textContent, foreground, background, ratio: (values[1] + 0.05) / (values[0] + 0.05) };
    }));
  }, stage);
  await testInfo.attach(`${stage}-contrast`, {
    body: JSON.stringify({ scope: 'specified preview labels and actions; conservative white backing', samples }, null, 2),
    contentType: 'application/json',
  });
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) expect(sample.ratio, `${stage}: ${sample.selector} ${sample.text}`).toBeGreaterThanOrEqual(4.5);
}

function expectInsideViewport(rect, viewport) {
  expect(rect).not.toBeNull();
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.y).toBeGreaterThanOrEqual(-1);
  expect(rect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
}

for (const { viewport, theme } of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
].flatMap(viewport => ['light', 'dark'].map(theme => ({ viewport, theme })))) {
  // Preserve the reviewed light-case identities; add explicit dark variants.
  const themeSuffix = theme === 'light' ? '' : ' dark';
  test(`desktop AI choices use the conversation width and retain draft/history at ${viewport.width}x${viewport.height}${themeSuffix}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await seedHome(page);
    await page.addInitScript(selectedTheme => localStorage.setItem('study-planner-theme-mode', selectedTheme), theme);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.locator('.primary-bottom-nav button').first().click();
    await waitForVisualReady(page, '.ai-planning-card');
    const geometry = await captureDesktopGeometry(page, testInfo, 'desktop-ai-choices', {
      conversation: '.ai-planning-conversation', starters: '.ai-planning-starters',
      first: '.ai-planning-starter-list button:nth-child(1)',
      second: '.ai-planning-starter-list button:nth-child(2)',
      third: '.ai-planning-starter-list button:nth-child(3)',
      label: '.ai-planning-starter-list button span',
      header: '.ai-planning-heading', composer: '.ai-planning-composer', nav: '.primary-bottom-nav',
      primaryHeader: '.ai-planning-primary-header',
    });
    expect(geometry.viewport).toEqual(viewport);
    expect(geometry.fonts).toBe('loaded');
    expect(geometry.document.width).toBeLessThanOrEqual(viewport.width);
    const { elements } = geometry;
    expect(elements.starters.width).toBeGreaterThan(elements.conversation.width * 0.85);
    expect(elements.label.fontSize).toBeGreaterThanOrEqual(14);
    for (const name of ['first', 'second', 'third', 'header', 'composer', 'nav', 'primaryHeader']) {
      expectInsideViewport(elements[name], viewport);
    }
    expect(elements.first.y).toBeCloseTo(elements.second.y, 0);
    expect(elements.first.y).toBeCloseTo(elements.third.y, 0);
    expect(elements.second.x).toBeGreaterThan(elements.first.right);
    expect(elements.third.x).toBeGreaterThan(elements.second.right);

    const composer = page.locator('.ai-planning-composer textarea');
    await composer.fill('保存前の相談を残す');
    await page.locator('.ai-planning-chat-menu-button').click();
    await expect(page.locator('.ai-chat-drawer')).toBeVisible();
    await expect(page.locator('.ai-chat-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'チャット一覧を閉じる' }).click();
    await expect(page.locator('.ai-chat-drawer')).toBeHidden();
    await expect(composer).toHaveValue('保存前の相談を残す');
  });

  test(`desktop AI proposal uses viewport space with reachable actions and separate detail scroll at ${viewport.width}x${viewport.height}${themeSuffix}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await seedMultiweekDraftPlan(page, 12, 30);
    await page.addInitScript(selectedTheme => localStorage.setItem('study-planner-theme-mode', selectedTheme), theme);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.locator('.primary-bottom-nav button').first().click();
    const planCard = page.locator('.ai-planning-plan-card');
    await expect(planCard).toContainText('12件の予定を作成');
    await expect(planCard).toContainText('合計 12時間');
    const composer = page.locator('.ai-planning-composer textarea');
    await composer.fill('日別を見てから調整する');
    await waitForVisualReady(page, '.ai-planning-card');
    const card = await captureDesktopGeometry(page, testInfo, 'desktop-ai-proposal-card', {
      conversation: '.ai-planning-conversation', card: '.ai-planning-plan-card', composer: '.ai-planning-composer',
      primaryHeader: '.ai-planning-primary-header',
    });
    if (theme === 'dark') await expectPreviewContrast(page, testInfo, 'desktop-ai-proposal-card');
    expectInsideViewport(card.elements.primaryHeader, viewport);
    expect(card.elements.card.width).toBeGreaterThan(card.elements.conversation.width * 0.85);
    expect(card.elements.conversation.scrollHeight).toBeGreaterThan(card.elements.conversation.clientHeight);
    expect(card.elements.conversation.overflowY).toBe('auto');
    expectInsideViewport(card.elements.composer, viewport);

    await page.getByRole('button', { name: '計画プレビューを確認' }).click();
    const preview = page.getByRole('dialog', { name: '計画プレビュー' });
    await expect(preview).toBeVisible();
    await waitForVisualReady(page, '.ai-planning-preview-dialog-v2');
    const overview = await captureDesktopGeometry(page, testInfo, 'desktop-ai-proposal-overview', {
      dialog: '.ai-planning-preview-dialog-v2', header: '.ai-planning-preview-header',
      calendar: '.ai-planning-preview-overview-body', actions: '.ai-planning-preview-actions',
      primary: '.ai-planning-primary-action', date: '.ai-planning-week-header strong',
    });
    if (theme === 'dark') await expectPreviewContrast(page, testInfo, 'desktop-ai-proposal-overview');
    else await expectPreviewContrast(page, testInfo, 'desktop-ai-proposal-overview-light-primary');
    expect(overview.document.width).toBeLessThanOrEqual(viewport.width);
    expect(overview.elements.dialog.width).toBeGreaterThan(viewport.width * 0.9);
    for (const name of ['dialog', 'header', 'calendar', 'actions', 'primary']) {
      expectInsideViewport(overview.elements[name], viewport);
    }
    expect(overview.elements.calendar.height).toBeGreaterThan(160);
    expect(overview.elements.primary.fontSize).toBeGreaterThanOrEqual(14);
    expect(overview.elements.date.fontSize).toBeGreaterThanOrEqual(14);
    await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(7);
    await preview.getByRole('button', { name: '次の期間を表示' }).click();
    await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(5);
    await preview.getByRole('button', { name: '前の期間を表示' }).click();

    // The readable detail view is reachable through the existing keyboard tabs.
    await preview.getByRole('tab', { name: '全体', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('tab', { name: '日別', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(preview.locator('.ai-planning-preview-day-detail')).toBeVisible();
    const dayScroll = preview.locator('.ai-planning-preview-day-scroll');
    await dayScroll.hover();
    await page.mouse.wheel(0, 1400);
    await expect.poll(() => dayScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await waitForVisualReady(page, '.ai-planning-preview-dialog-v2');
    const detail = await captureDesktopGeometry(page, testInfo, 'desktop-ai-proposal-detail', {
      scroll: '.ai-planning-preview-day-scroll', label: '.ai-planning-preview-detail-block strong',
      actions: '.ai-planning-preview-actions', header: '.ai-planning-preview-header',
    });
    if (theme === 'dark') await expectPreviewContrast(page, testInfo, 'desktop-ai-proposal-detail');
    else await expectPreviewContrast(page, testInfo, 'desktop-ai-proposal-detail-light-primary');
    expect(detail.elements.scroll.scrollHeight).toBeGreaterThan(detail.elements.scroll.clientHeight);
    expect(detail.elements.scroll.overflowY).toBe('auto');
    expect(detail.elements.label.fontSize).toBeGreaterThanOrEqual(14);
    expect(detail.document.y).toBe(0);
    expectInsideViewport(detail.elements.actions, viewport);
    expectInsideViewport(detail.elements.header, viewport);
    await preview.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(composer).toHaveValue('日別を見てから調整する');
    await expect(planCard).toContainText('12件の予定を作成');
    await expect(page.locator('.ai-planning-conversation')).toHaveCSS('overflow-y', 'auto');
  });
}

test('dark compact AI proposal retains readable overview and day detail', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMultiweekDraftPlan(page, 12, 30);
  await page.addInitScript(() => localStorage.setItem('study-planner-theme-mode', 'dark'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.primary-bottom-nav button').first().click();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await waitForVisualReady(page, '.ai-planning-preview-dialog-v2');
  await captureDesktopGeometry(page, testInfo, 'compact-ai-proposal-overview', {
    dialog: '.ai-planning-preview-dialog-v2', header: '.ai-planning-preview-header',
  });
  await expectPreviewContrast(page, testInfo, 'compact-ai-proposal-overview');
  await preview.getByRole('tab', { name: '日別', exact: true }).click();
  await waitForVisualReady(page, '.ai-planning-preview-day-detail');
  await captureDesktopGeometry(page, testInfo, 'compact-ai-proposal-detail', {
    dialog: '.ai-planning-preview-dialog-v2', header: '.ai-planning-preview-header',
  });
  await expectPreviewContrast(page, testInfo, 'compact-ai-proposal-detail');
  await preview.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(preview).toBeHidden();
});
