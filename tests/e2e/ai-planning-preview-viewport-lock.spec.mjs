import { expect, test } from '@playwright/test';

async function seedScrollableAiPreview(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const today = new Date();
    const user = {
      id: 'ai-preview-viewport-lock-user',
      email: 'ai-preview-viewport-lock@example.com',
      username: 'ai-preview-viewport-lock-user',
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
      id: `preview-lock-${index + 1}`,
      userId: user.id,
      date: toIsoDate(addDays(today, index + 1)),
      startTime: '09:00',
      endTime: '10:00',
      title: '金フレ 1時間',
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
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `背景スクロール分離の回帰テスト用メッセージ ${index + 1}。`,
      createdAt: now,
    }));
    const planningState = {
      weekStartDate,
      revision: 1,
      conversationRequestSequence: 0,
      mode: 'draft_created',
      draftBlocks,
      previewCandidates,
      messages,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
    localStorage.setItem(
      `studyplanner.weeklyPlanning.${user.id}.${weekStartDate}`,
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

async function shortTouchDrag(sheet) {
  return sheet.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const identifier = 51;
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 28;
    const makeTouch = (x, y) => ({ identifier, clientX: x, clientY: y });
    const makeTouchList = (touch) => ({
      0: touch ?? undefined,
      length: touch ? 1 : 0,
      item: (index) => (touch && index === 0 ? touch : null),
    });
    const dispatch = (type, x, y, active) => {
      const touch = makeTouch(x, y);
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', {
        value: makeTouchList(active ? touch : null),
      });
      Object.defineProperty(event, 'changedTouches', {
        value: makeTouchList(touch),
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };

    dispatch('touchstart', startX, startY, true);
    const pendingMovePrevented = dispatch('touchmove', startX + 1, startY + 4, true);
    const verticalMovePrevented = dispatch('touchmove', startX + 2, startY + 24, true);
    dispatch('touchend', startX + 2, startY + 24, false);
    return { pendingMovePrevented, verticalMovePrevented };
  });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('AI planning preview isolates touch movement from the conversation and viewport behind it', async ({ page }) => {
  await seedScrollableAiPreview(page);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();

  const conversation = page.locator('.ai-planning-conversation');
  expect(await conversation.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await conversation.evaluate((element) => {
    element.scrollTop = Math.min(320, element.scrollHeight - element.clientHeight);
  });

  const previousViewportStyles = await page.evaluate(() => ({
    rootOverflow: document.documentElement.style.overflow,
    rootOverscrollBehavior: document.documentElement.style.overscrollBehavior,
    bodyOverflow: document.body.style.overflow,
    bodyOverscrollBehavior: document.body.style.overscrollBehavior,
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyLeft: document.body.style.left,
    bodyRight: document.body.style.right,
    bodyWidth: document.body.style.width,
  }));

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  const overlay = page.locator('.ai-planning-preview-overlay-v2');
  const header = preview.locator('.ai-planning-preview-header');
  const motion = page.locator('.ai-planning-preview-motion');
  await expect(preview).toBeVisible();

  await expect(conversation).toHaveCSS('overflow-y', 'hidden');
  await expect(overlay).toHaveCSS('overscroll-behavior', 'none');
  await expect(header).toHaveCSS('touch-action', 'none');
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  expect(await page.evaluate(() => document.documentElement.style.overscrollBehavior)).toBe('none');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  expect(await page.evaluate(() => document.body.style.overscrollBehavior)).toBe('none');
  expect(await page.evaluate(() => document.body.style.position)).toBe('fixed');

  const lockedConversationScrollTop = await conversation.evaluate((element) => element.scrollTop);
  const backgroundBeforeDrag = await conversation.boundingBox();
  expect(backgroundBeforeDrag).not.toBeNull();

  const dragResult = await shortTouchDrag(preview);
  expect(dragResult.verticalMovePrevented).toBe(true);
  await page.waitForTimeout(240);

  expect(await conversation.evaluate((element) => element.scrollTop)).toBe(lockedConversationScrollTop);
  const backgroundAfterDrag = await conversation.boundingBox();
  expect(backgroundAfterDrag).not.toBeNull();
  if (backgroundBeforeDrag && backgroundAfterDrag) {
    expect(Math.abs(backgroundAfterDrag.x - backgroundBeforeDrag.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(backgroundAfterDrag.y - backgroundBeforeDrag.y)).toBeLessThanOrEqual(1);
  }

  await preview.getByRole('button', { name: '閉じる' }).click();
  await expect(motion).toHaveClass(/is-closing/);
  expect(await page.evaluate(() => document.body.style.position)).toBe('fixed');
  await expect(preview).toBeHidden({ timeout: 1500 });

  expect(await page.evaluate(() => ({
    rootOverflow: document.documentElement.style.overflow,
    rootOverscrollBehavior: document.documentElement.style.overscrollBehavior,
    bodyOverflow: document.body.style.overflow,
    bodyOverscrollBehavior: document.body.style.overscrollBehavior,
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyLeft: document.body.style.left,
    bodyRight: document.body.style.right,
    bodyWidth: document.body.style.width,
  }))).toEqual(previousViewportStyles);
});
