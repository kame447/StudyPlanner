import { expect, test } from '@playwright/test';

function seedBookshelfInteractionState(page) {
  return page.addInitScript(() => {
    const createdAt = new Date().toISOString();
    const user = {
      id: 'bookshelf-interaction-user',
      email: 'bookshelf-interaction@example.com',
      username: 'bookshelf-interaction',
      avatar: '',
      createdAt,
    };
    const subject = {
      id: 'bookshelf-interaction-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt,
      updatedAt: createdAt,
    };
    const material = {
      id: 'bookshelf-interaction-material',
      userId: user.id,
      name: '回帰テスト教材',
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      status: 'active',
      paceEnabled: false,
      progressUnit: 'page',
      createdAt,
      updatedAt: createdAt,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  });
}

async function openPrimaryTab(page, label, surfaceSelector) {
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: label })
    .click();
  await expect(page.locator(surfaceSelector)).toBeVisible();
}

async function readIconOffset(fab, icon) {
  return fab.evaluate((button, iconSelector) => {
    const iconElement = button.querySelector(iconSelector);
    if (!(iconElement instanceof SVGElement)) {
      throw new Error(`missing FAB icon: ${iconSelector}`);
    }

    const buttonRect = button.getBoundingClientRect();
    const iconRect = iconElement.getBoundingClientRect();
    return {
      x: iconRect.left + iconRect.width / 2 - (buttonRect.left + buttonRect.width / 2),
      y: iconRect.top + iconRect.height / 2 - (buttonRect.top + buttonRect.height / 2),
    };
  }, icon);
}

async function swipeDown(sheet) {
  return sheet.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const identifier = 29;
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 28;

    const makeTouch = (x, y) => ({ identifier, clientX: x, clientY: y });
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
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };

    dispatchTouch('touchstart', startX, startY, true);
    const movePrevented = dispatchTouch('touchmove', startX + 2, startY + 92, true);
    const dragOffset = element.style.getPropertyValue('--planner-bottom-sheet-drag-y');
    const dragging = element.classList.contains('is-bottom-sheet-dragging');
    dispatchTouch('touchend', startX + 2, startY + 128, false);

    return { movePrevented, dragOffset, dragging };
  });
}

test.describe('bookshelf add-material interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedBookshelfInteractionState(page);
    await page.goto('/');
  });

  test('centers the plus icon exactly like Schedule', async ({ page }) => {
    await openPrimaryTab(page, '予定', '.schedule-workspace-shell');
    const scheduleFab = page.locator('.schedule-add-fab.daily-add-fab');
    await expect(scheduleFab).toBeVisible();
    const scheduleOffset = await readIconOffset(scheduleFab, '.quick-add-trigger-icon');

    await openPrimaryTab(page, '教材', '.bookshelf-view');
    const bookshelfFab = page.locator('.bookshelf-add-material-fab');
    await expect(bookshelfFab).toBeVisible();
    const bookshelfOffset = await readIconOffset(bookshelfFab, 'svg');

    expect(Math.abs(scheduleOffset.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(scheduleOffset.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bookshelfOffset.x - scheduleOffset.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bookshelfOffset.y - scheduleOffset.y)).toBeLessThanOrEqual(1);
  });

  test('uses the same downward drag-to-dismiss behavior as Schedule', async ({ page }) => {
    await openPrimaryTab(page, '予定', '.schedule-workspace-shell');
    const scheduleFab = page.locator('.schedule-add-fab.daily-add-fab');
    await scheduleFab.click();
    await page.getByRole('menuitem', { name: '学習を追加' }).click();

    const scheduleOverlay = page.locator('.quick-entry-overlay');
    const scheduleSheet = page.locator('.quick-entry-modal');
    await expect(scheduleSheet).toBeVisible();
    const scheduleDrag = await swipeDown(scheduleSheet);
    expect(scheduleDrag.movePrevented).toBe(true);
    expect(scheduleDrag.dragging).toBe(true);
    expect(Number.parseFloat(scheduleDrag.dragOffset)).toBeGreaterThan(70);
    await expect(scheduleOverlay).toHaveCount(0, { timeout: 1_500 });

    await openPrimaryTab(page, '教材', '.bookshelf-view');
    const bookshelfFab = page.locator('.bookshelf-add-material-fab');
    await bookshelfFab.click();

    const bookshelfOverlay = page.locator(
      '.bookshelf-view > .modal-overlay:has(> .bookshelf-modal .bookshelf-material-edit-grid)',
    );
    const bookshelfSheet = bookshelfOverlay.locator(':scope > .bookshelf-modal');
    await expect(bookshelfSheet).toBeVisible();
    const bookshelfDrag = await swipeDown(bookshelfSheet);
    expect(bookshelfDrag.movePrevented).toBe(true);
    expect(bookshelfDrag.dragging).toBe(true);
    expect(Number.parseFloat(bookshelfDrag.dragOffset)).toBeGreaterThan(70);
    await expect(bookshelfOverlay).toHaveCount(0, { timeout: 1_500 });
  });
});
