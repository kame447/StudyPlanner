import { expect, test } from '@playwright/test';

async function seedMultiweekDraftPlan(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const today = new Date();
    const user = {
      id: 'ai-planning-preview-interaction-user',
      email: 'preview-interaction@example.com',
      username: 'preview-interaction-user',
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

async function swipeSheetDown(sheet) {
  return sheet.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const identifier = 17;
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 28;
    const target = element;

    const makeTouch = (x, y) => ({
      identifier,
      clientX: x,
      clientY: y,
    });
    const makeTouchList = (touch) => ({
      0: touch ?? undefined,
      length: touch ? 1 : 0,
      item: (index) => (touch && index === 0 ? touch : null),
    });
    const dispatchTouch = (type, x, y, active) => {
      const touch = makeTouch(x, y);
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', {
        value: makeTouchList(active ? touch : null),
      });
      Object.defineProperty(event, 'changedTouches', {
        value: makeTouchList(touch),
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    dispatchTouch('touchstart', startX, startY, true);
    const movePrevented = dispatchTouch('touchmove', startX + 3, startY + 96, true);
    const dragOffset = element.style.getPropertyValue('--planner-bottom-sheet-drag-y');
    const dragging = element.classList.contains('is-bottom-sheet-dragging');
    dispatchTouch('touchend', startX + 3, startY + 124, false);

    return { movePrevented, dragOffset, dragging };
  });
}

test('AI planning preview fits seven days and restores tap-to-day detail on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMultiweekDraftPlan(page);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-preview-period-nav')).toContainText('1 / 2');
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(7);
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(7);

  const overviewMetrics = await preview.locator('.ai-planning-preview-overview-scroll').evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    clientHeight: node.clientHeight,
  }));
  expect(overviewMetrics.scrollWidth).toBeLessThanOrEqual(overviewMetrics.clientWidth + 1);
  expect(overviewMetrics.clientHeight).toBeGreaterThan(280);

  const firstDate = preview.locator('.ai-planning-week-header > div').first();
  const firstDateText = await firstDate.locator('strong').textContent();
  await firstDate.click();

  await expect(preview.getByRole('tab', { name: '日別' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.locator('.ai-planning-preview-day-detail')).toBeVisible();
  await expect(preview.locator('.ai-planning-preview-day-nav strong')).toHaveText(firstDateText ?? '');
  await expect(preview.locator('.ai-planning-preview-day-column-detail .ai-planning-draft-block')).toHaveCount(1);

  await preview.getByRole('button', { name: '翌日を表示' }).click();
  await expect(preview.locator('.ai-planning-preview-day-nav strong')).not.toHaveText(firstDateText ?? '');

  await preview.getByRole('tab', { name: '全体' }).click();
  await expect(preview.getByRole('tab', { name: '全体' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(7);

  await preview.getByRole('button', { name: '次の期間を表示' }).click();
  await expect(preview.locator('.ai-planning-preview-period-nav')).toContainText('2 / 2');
  await expect(preview.locator('.ai-planning-week-header > div')).toHaveCount(5);
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(5);

  await page.screenshot({
    path: 'artifacts/ai-planning-preview-overview-day-mobile.png',
    fullPage: true,
  });
});

test('AI planning preview rises from the bottom and follows a swipe-down dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMultiweekDraftPlan(page);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();

  const presentation = await preview.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      bottomGap: window.innerHeight - rect.bottom,
    };
  });
  expect(presentation.animationName).toContain('planner-bottom-sheet-in');
  expect(Math.abs(presentation.bottomGap)).toBeLessThanOrEqual(1);

  const dragFeedback = await swipeSheetDown(preview);
  expect(dragFeedback.movePrevented).toBe(true);
  expect(dragFeedback.dragging).toBe(true);
  expect(Number.parseFloat(dragFeedback.dragOffset)).toBeGreaterThan(70);

  await expect(preview).toBeHidden({ timeout: 1500 });
});
