import { expect, test } from '@playwright/test';

function isoToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

async function seedMobileOverlayState(page) {
  await page.addInitScript(({ today }) => {
    const now = new Date().toISOString();
    const user = {
      id: 'mobile-overlay-user',
      email: 'mobile-overlay@example.com',
      username: 'mobile-overlay-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'mobile-overlay-plan',
      seriesId: 'mobile-overlay-plan',
      userId: user.id,
      title: '卒研 論文整理',
      subject: '研究',
      type: 'study',
      date: today,
      startTime: '20:00',
      endTime: '21:30',
      memo: '関連研究の主張と自分の研究との差分を整理する。',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const monthEvent = {
      id: 'mobile-overlay-month-event',
      userId: user.id,
      date: today,
      endDate: today,
      title: '予定ピッカー検証',
      startTime: '09:00',
      endTime: '10:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      url: '',
      memo: '',
      checklist: [],
      locationTags: [],
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.monthEvents', JSON.stringify([monthEvent]));
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  }, { today: isoToday() });
}

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-month-view')).toBeVisible();
}

test.describe('mobile overlay stability', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('study session keeps its root surface pinned while only the page scrolls', async ({ page }) => {
    await seedMobileOverlayState(page);
    await page.goto('/');
    await page.getByRole('button', { name: '学習を開始する' }).click();

    const overlay = page.locator('.study-session-overlay');
    const sessionPage = overlay.locator('.study-session-page');
    await expect(overlay).toBeVisible();

    const initial = await overlay.evaluate((element) => {
      const pageElement = element.querySelector('.study-session-page');
      if (!(pageElement instanceof HTMLElement)) return null;
      const overlayStyle = getComputedStyle(element);
      const pageStyle = getComputedStyle(pageElement);
      const overlayBox = element.getBoundingClientRect();
      return {
        overlayPosition: overlayStyle.position,
        overlayOverflowY: overlayStyle.overflowY,
        overlayOverscrollY: overlayStyle.overscrollBehaviorY,
        pageOverflowY: pageStyle.overflowY,
        pageOverscrollY: pageStyle.overscrollBehaviorY,
        overlayTop: overlayBox.top,
        overlayBottom: overlayBox.bottom,
        viewportHeight: window.innerHeight,
        pageScrollHeight: pageElement.scrollHeight,
        pageClientHeight: pageElement.clientHeight,
      };
    });

    expect(initial).not.toBeNull();
    expect(initial.overlayPosition).toBe('fixed');
    expect(initial.overlayOverflowY).toBe('hidden');
    expect(initial.overlayOverscrollY).toBe('none');
    expect(initial.pageOverflowY).toBe('auto');
    expect(initial.pageOverscrollY).toBe('none');
    expect(initial.overlayTop).toBeCloseTo(0, 0);
    expect(initial.overlayBottom).toBeCloseTo(initial.viewportHeight, 0);
    expect(initial.pageScrollHeight).toBeGreaterThan(initial.pageClientHeight);

    await sessionPage.evaluate((element) => {
      element.scrollTop = Math.min(320, element.scrollHeight - element.clientHeight);
    });
    await expect.poll(() => sessionPage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const afterScroll = await overlay.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight };
    });
    expect(afterScroll.top).toBeCloseTo(0, 0);
    expect(afterScroll.bottom).toBeCloseTo(afterScroll.viewportHeight, 0);
  });

  test('existing month event editor owns the viewport and date picker owns the hit target', async ({ page }, testInfo) => {
    await seedMobileOverlayState(page);
    await openSchedule(page);

    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    const selectedCell = grid.locator('[role="gridcell"][aria-selected="true"]');
    await expect(selectedCell).toHaveCount(1);
    await selectedCell.click();

    const daySheet = page.locator('.month-day-sheet');
    await expect(daySheet).toBeVisible();
    await daySheet.locator('.month-day-sheet-event').filter({ hasText: '予定ピッカー検証' }).click();

    const motionRoot = page.locator('body > .month-event-dialog-motion');
    const editorOverlay = page.locator('.month-event-modal-overlay');
    const editor = editorOverlay.locator('.month-event-modal');
    const editorHeader = editor.locator('.month-event-editor-header');
    const editorBody = editor.locator('.month-event-editor-body');
    const editorActions = editor.locator('.month-event-editor-actions');
    await expect(motionRoot).toHaveCount(1);
    await expect(editorOverlay).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(editorHeader).toBeVisible();
    await expect(editorBody).toBeVisible();
    await expect(editorActions).toBeVisible();

    const viewportOwnership = await editorOverlay.evaluate((element) => {
      const overlayBox = element.getBoundingClientRect();
      const overlayStyle = getComputedStyle(element);
      const toolbar = document.querySelector('.schedule-toolbar');
      const bottomNav = document.querySelector('.schedule-bottom-nav');
      const header = element.querySelector('.month-event-editor-header');

      if (
        !(toolbar instanceof HTMLElement) ||
        !(bottomNav instanceof HTMLElement) ||
        !(header instanceof HTMLElement)
      ) {
        return null;
      }

      const ownsPoint = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || (hit instanceof Node && element.contains(hit));
      };
      const toolbarBox = toolbar.getBoundingClientRect();
      const bottomNavBox = bottomNav.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      const headerHit = document.elementFromPoint(
        headerBox.left + headerBox.width / 2,
        headerBox.top + headerBox.height / 2,
      );

      return {
        position: overlayStyle.position,
        top: overlayBox.top,
        left: overlayBox.left,
        right: overlayBox.right,
        bottom: overlayBox.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        motionRootIsBodyChild: element.parentElement?.parentElement === document.body,
        ownsToolbarPoint: ownsPoint(
          toolbarBox.left + toolbarBox.width / 2,
          toolbarBox.top + toolbarBox.height / 2,
        ),
        ownsBottomNavPoint: ownsPoint(
          bottomNavBox.left + bottomNavBox.width / 2,
          bottomNavBox.top + bottomNavBox.height / 2,
        ),
        headerOwnsHitTarget:
          headerHit === header || (headerHit instanceof Node && header.contains(headerHit)),
      };
    });

    expect(viewportOwnership).not.toBeNull();
    expect(viewportOwnership.position).toBe('fixed');
    expect(viewportOwnership.motionRootIsBodyChild).toBe(true);
    expect(viewportOwnership.top).toBeCloseTo(0, 0);
    expect(viewportOwnership.left).toBeCloseTo(0, 0);
    expect(viewportOwnership.right).toBeCloseTo(viewportOwnership.viewportWidth, 0);
    expect(viewportOwnership.bottom).toBeCloseTo(viewportOwnership.viewportHeight, 0);
    expect(viewportOwnership.ownsToolbarPoint).toBe(true);
    expect(viewportOwnership.ownsBottomNavPoint).toBe(true);
    expect(viewportOwnership.headerOwnsHitTarget).toBe(true);

    const editorGeometry = await editor.evaluate((element) => {
      const header = element.querySelector('.month-event-editor-header');
      const body = element.querySelector('.month-event-editor-body');
      const actions = element.querySelector('.month-event-editor-actions');
      if (
        !(header instanceof HTMLElement) ||
        !(body instanceof HTMLElement) ||
        !(actions instanceof HTMLElement)
      ) {
        return null;
      }

      const editorBox = element.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        editorTop: editorBox.top,
        editorBottom: editorBox.bottom,
        viewportHeight: window.innerHeight,
        headerBottom: headerBox.bottom,
        bodyTop: bodyBox.top,
        bodyBottom: bodyBox.bottom,
        actionsTop: actionsBox.top,
        rowTemplate: style.gridTemplateRows,
      };
    });

    expect(editorGeometry).not.toBeNull();
    expect(editorGeometry.editorTop).toBeGreaterThanOrEqual(-1);
    expect(editorGeometry.editorBottom).toBeLessThanOrEqual(editorGeometry.viewportHeight + 1);
    expect(editorGeometry.bodyTop).toBeGreaterThanOrEqual(editorGeometry.headerBottom - 1);
    expect(editorGeometry.actionsTop).toBeGreaterThanOrEqual(editorGeometry.bodyBottom - 1);
    expect(editorGeometry.rowTemplate.split(' ')).toHaveLength(3);

    await page.screenshot({
      path: testInfo.outputPath('month-event-editor-viewport.png'),
      fullPage: false,
    });

    const startDateButton = editor.getByRole('button', { name: '開始日' });
    const beforeLabel = (await startDateButton.textContent())?.trim() ?? '';
    await startDateButton.click();

    const pickerOverlay = editorOverlay.locator(':scope > .date-picker-overlay');
    const pickerModal = pickerOverlay.locator('.day-calendar-modal');
    await expect(pickerOverlay).toBeVisible();
    await expect(pickerModal).toBeVisible();

    const layers = await page.evaluate(() => {
      const editorElement = document.querySelector('.month-event-modal');
      const pickerOverlayElement = document.querySelector('.month-event-modal-overlay > .date-picker-overlay');
      const pickerModalElement = pickerOverlayElement?.querySelector('.day-calendar-modal');
      if (
        !(editorElement instanceof HTMLElement) ||
        !(pickerOverlayElement instanceof HTMLElement) ||
        !(pickerModalElement instanceof HTMLElement)
      ) {
        return null;
      }
      const pickerBox = pickerModalElement.getBoundingClientRect();
      return {
        editor: Number.parseInt(getComputedStyle(editorElement).zIndex, 10),
        pickerOverlay: Number.parseInt(getComputedStyle(pickerOverlayElement).zIndex, 10),
        pickerModal: Number.parseInt(getComputedStyle(pickerModalElement).zIndex, 10),
        pickerTop: pickerBox.top,
        pickerBottom: pickerBox.bottom,
        viewportHeight: window.innerHeight,
      };
    });

    expect(layers).not.toBeNull();
    expect(layers.pickerOverlay).toBeGreaterThan(layers.editor);
    expect(layers.pickerModal).toBeGreaterThan(layers.pickerOverlay);
    expect(layers.pickerTop).toBeGreaterThanOrEqual(-1);
    expect(layers.pickerBottom).toBeLessThanOrEqual(layers.viewportHeight + 1);

    const targetDay = pickerModal.locator('.mini-calendar-day:not(.is-outside):not(.is-selected)').first();
    await expect(targetDay).toBeVisible();
    const targetDayLabel = await targetDay.getAttribute('aria-label');
    if (!targetDayLabel) {
      throw new Error('Target day must expose a stable accessible label.');
    }

    const ownsHitTarget = await targetDay.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === element || element.contains(hit);
    });
    expect(ownsHitTarget).toBe(true);

    await targetDay.click();
    const selectedTargetDay = pickerModal.getByRole('button', { name: targetDayLabel, exact: true });
    await expect(selectedTargetDay).toHaveClass(/is-selected/);
    const knob = pickerModal.locator('.mini-calendar-selection-knob');
    await expect(knob).toHaveClass(/is-ready/);
    await expect(knob).toHaveClass(/is-animated/);

    const motion = await knob.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        transitionDuration: style.transitionDuration,
        transitionTimingFunction: style.transitionTimingFunction,
      };
    });
    expect(motion.transitionDuration).not.toBe('0s');
    expect(motion.transitionTimingFunction).toContain('cubic-bezier');

    await expect(pickerOverlay).toHaveCount(0);
    await expect(editorOverlay).toBeVisible();
    const afterLabel = (await startDateButton.textContent())?.trim() ?? '';
    expect(afterLabel).not.toBe(beforeLabel);
  });
});
