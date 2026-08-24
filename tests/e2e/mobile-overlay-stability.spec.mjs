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

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
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

  test('month event date picker renders above the editor and accepts a date selection', async ({ page }) => {
    await seedMobileOverlayState(page);
    await openSchedule(page);

    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    const selectedCell = grid.locator('[role="gridcell"][aria-selected="true"]');
    await expect(selectedCell).toHaveCount(1);
    await selectedCell.focus();
    await page.keyboard.press('Enter');

    const editorOverlay = page.locator('.month-event-modal-overlay');
    const editor = editorOverlay.locator('.month-event-modal');
    await expect(editorOverlay).toBeVisible();
    await expect(editor).toBeVisible();

    const startDateButton = editor.getByRole('button', { name: '開始日' });
    const beforeLabel = (await startDateButton.textContent())?.trim() ?? '';
    await startDateButton.click();

    const pickerOverlay = editorOverlay.locator(':scope > .date-picker-overlay');
    const pickerModal = pickerOverlay.locator('.day-calendar-modal');
    await expect(pickerOverlay).toBeVisible();
    await expect(pickerModal).toBeVisible();

    const layers = await page.evaluate(() => {
      const editor = document.querySelector('.month-event-modal');
      const pickerOverlay = document.querySelector('.month-event-modal-overlay > .date-picker-overlay');
      const pickerModal = pickerOverlay?.querySelector('.day-calendar-modal');
      if (!(editor instanceof HTMLElement) || !(pickerOverlay instanceof HTMLElement) || !(pickerModal instanceof HTMLElement)) {
        return null;
      }
      return {
        editor: Number.parseInt(getComputedStyle(editor).zIndex, 10),
        pickerOverlay: Number.parseInt(getComputedStyle(pickerOverlay).zIndex, 10),
        pickerModal: Number.parseInt(getComputedStyle(pickerModal).zIndex, 10),
      };
    });

    expect(layers).not.toBeNull();
    expect(layers.pickerOverlay).toBeGreaterThan(layers.editor);
    expect(layers.pickerModal).toBeGreaterThan(layers.pickerOverlay);

    const targetDay = pickerModal.locator('.mini-calendar-day:not(.is-outside):not(.is-selected)').first();
    await expect(targetDay).toBeVisible();
    await targetDay.click();

    await expect(pickerOverlay).toHaveCount(0);
    await expect(editorOverlay).toBeVisible();
    const afterLabel = (await startDateButton.textContent())?.trim() ?? '';
    expect(afterLabel).not.toBe(beforeLabel);
  });
});
