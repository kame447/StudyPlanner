import { expect, test } from '@playwright/test';

function seedBookshelfMobileState(page) {
  return page.addInitScript(() => {
    const now = new Date();
    const createdAt = now.toISOString();
    const user = {
      id: 'bookshelf-mobile-user',
      email: 'bookshelf-mobile@example.com',
      username: 'bookshelf-mobile',
      avatar: '',
      createdAt,
    };
    const subject = {
      id: 'bookshelf-mobile-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt,
      updatedAt: createdAt,
    };
    const materials = Array.from({ length: 12 }, (_, index) => ({
      id: `bookshelf-mobile-material-${index + 1}`,
      userId: user.id,
      name: `モバイル回帰教材 ${index + 1}`,
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      status: 'active',
      paceEnabled: false,
      progressUnit: 'page',
      createdAt: new Date(Date.now() - index * 60_000).toISOString(),
      updatedAt: createdAt,
    }));

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(materials));
  });
}

async function openBookshelf(page) {
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '教材' })
    .click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
}

test.describe('bookshelf add-material mobile surface', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('uses a circular plus FAB and opens the add form inside the visual viewport', async ({ page }) => {
    await seedBookshelfMobileState(page);
    await page.goto('/');
    await openBookshelf(page);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    const fab = page.locator('.bookshelf-add-material-fab');
    await expect(fab).toBeVisible();

    const fabGeometry = await fab.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        width: rect.width,
        height: rect.height,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
        position: style.position,
        radius: style.borderRadius,
        fontSize: style.fontSize,
      };
    });

    expect(fabGeometry.position).toBe('fixed');
    expect(fabGeometry.width).toBeCloseTo(56, 0);
    expect(fabGeometry.height).toBeCloseTo(56, 0);
    expect(fabGeometry.right).toBeGreaterThanOrEqual(14);
    expect(fabGeometry.bottom).toBeGreaterThan(58);
    expect(fabGeometry.radius).toBe('50%');
    expect(fabGeometry.fontSize).toBe('0px');

    await fab.click();

    const overlay = page.locator('.bookshelf-view > .modal-overlay');
    const modal = overlay.locator(':scope > .bookshelf-modal');
    await expect(page.getByRole('heading', { name: '教材を追加' })).toBeVisible();
    await expect(modal).toBeVisible();

    const modalGeometry = await overlay.evaluate((overlayElement) => {
      const modalElement = overlayElement.querySelector('.bookshelf-modal');
      if (!(modalElement instanceof HTMLElement)) {
        throw new Error('bookshelf modal was not mounted');
      }
      const overlayRect = overlayElement.getBoundingClientRect();
      const modalRect = modalElement.getBoundingClientRect();
      return {
        overlayTop: overlayRect.top,
        overlayBottom: overlayRect.bottom,
        overlayHeight: overlayRect.height,
        overlayOverflowY: getComputedStyle(overlayElement).overflowY,
        modalTop: modalRect.top,
        modalBottom: modalRect.bottom,
        modalScrollTop: modalElement.scrollTop,
        viewportHeight: window.innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(Math.abs(modalGeometry.overlayTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(modalGeometry.overlayHeight - modalGeometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(modalGeometry.overlayBottom).toBeLessThanOrEqual(modalGeometry.viewportHeight + 1);
    expect(modalGeometry.overlayOverflowY).toBe('hidden');
    expect(modalGeometry.modalTop).toBeGreaterThanOrEqual(0);
    expect(modalGeometry.modalBottom).toBeLessThanOrEqual(modalGeometry.viewportHeight + 1);
    expect(modalGeometry.modalScrollTop).toBe(0);
    expect(modalGeometry.pageWidth).toBeLessThanOrEqual(modalGeometry.viewportWidth + 1);
  });
});
