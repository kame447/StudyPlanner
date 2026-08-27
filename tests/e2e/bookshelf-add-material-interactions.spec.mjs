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

async function dragSheetDown(page, sheet) {
  const box = await sheet.boundingBox();
  if (!box) {
    throw new Error('bottom sheet has no bounding box');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + 28;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 180, { steps: 6 });
  await page.mouse.up();
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

    const scheduleSheet = page.locator('.quick-entry-modal');
    await expect(scheduleSheet).toBeVisible();
    await dragSheetDown(page, scheduleSheet);
    await expect(scheduleSheet).toBeHidden({ timeout: 2_000 });

    await openPrimaryTab(page, '教材', '.bookshelf-view');
    const bookshelfFab = page.locator('.bookshelf-add-material-fab');
    await bookshelfFab.click();

    const bookshelfSheet = page.locator(
      '.bookshelf-view > .modal-overlay > .bookshelf-modal:has(.bookshelf-material-edit-grid)',
    );
    await expect(bookshelfSheet).toBeVisible();
    await dragSheetDown(page, bookshelfSheet);
    await expect(bookshelfSheet).toBeHidden({ timeout: 2_000 });
  });
});
