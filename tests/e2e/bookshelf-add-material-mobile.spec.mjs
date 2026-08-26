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

async function readFabGeometry(fab) {
  return fab.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      position: style.position,
      radius: style.borderRadius,
      fontSize: style.fontSize,
    };
  });
}

test.describe('bookshelf add-material mobile surface', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the plus fixed to the viewport and opens a bottom sheet from any scroll position', async ({ page }, testInfo) => {
    await seedBookshelfMobileState(page);
    await page.goto('/');
    await openBookshelf(page);

    const bookshelfTransform = await page.locator('.bookshelf-view').evaluate((element) =>
      getComputedStyle(element).transform,
    );
    expect(bookshelfTransform).toBe('none');

    const fab = page.locator('.bookshelf-add-material-fab');
    await expect(fab).toBeVisible();
    await expect(fab).toHaveAccessibleName('教材追加');

    const beforeScroll = await readFabGeometry(fab);
    expect(beforeScroll.position).toBe('fixed');
    expect(beforeScroll.width).toBeCloseTo(56, 0);
    expect(beforeScroll.height).toBeCloseTo(56, 0);
    expect(beforeScroll.right).toBeGreaterThanOrEqual(14);
    expect(beforeScroll.bottom).toBeGreaterThan(58);
    expect(beforeScroll.radius).toBe('50%');
    expect(beforeScroll.fontSize).toBe('0px');

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(50);

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    const afterScroll = await readFabGeometry(fab);
    expect(Math.abs(afterScroll.top - beforeScroll.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterScroll.right - beforeScroll.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterScroll.bottom - beforeScroll.bottom)).toBeLessThanOrEqual(1);

    await testInfo.attach('bookshelf-fab-scrolled.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });

    await fab.click();

    const overlay = page.locator('.bookshelf-view > .modal-overlay').filter({
      has: page.locator(':scope > .bookshelf-modal'),
    });
    const modal = overlay.locator(':scope > .bookshelf-modal');
    await expect(page.getByRole('heading', { name: '教材を追加' })).toBeVisible();
    await expect(modal).toBeVisible();

    await modal.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });

    const modalGeometry = await overlay.evaluate((overlayElement) => {
      const modalElement = overlayElement.querySelector('.bookshelf-modal');
      if (!(modalElement instanceof HTMLElement)) {
        throw new Error('bookshelf modal was not mounted');
      }
      const overlayRect = overlayElement.getBoundingClientRect();
      const modalRect = modalElement.getBoundingClientRect();
      const overlayStyle = getComputedStyle(overlayElement);
      const modalStyle = getComputedStyle(modalElement);
      const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
      return {
        overlayTop: overlayRect.top,
        overlayBottom: overlayRect.bottom,
        overlayHeight: overlayRect.height,
        overlayPosition: overlayStyle.position,
        overlayOverflowY: overlayStyle.overflowY,
        modalTop: modalRect.top,
        modalBottom: modalRect.bottom,
        modalScrollTop: modalElement.scrollTop,
        modalBottomLeftRadius: modalStyle.borderBottomLeftRadius,
        modalTopLeftRadius: modalStyle.borderTopLeftRadius,
        viewportHeight: window.innerHeight,
        visualViewportHeight,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(modalGeometry.overlayPosition).toBe('fixed');
    expect(Math.abs(modalGeometry.overlayTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(modalGeometry.overlayHeight - modalGeometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(modalGeometry.overlayBottom).toBeLessThanOrEqual(modalGeometry.viewportHeight + 1);
    expect(modalGeometry.overlayOverflowY).toBe('hidden');
    expect(modalGeometry.modalTop).toBeGreaterThanOrEqual(0);
    expect(Math.abs(modalGeometry.modalBottom - modalGeometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(modalGeometry.modalBottom).toBeLessThanOrEqual(modalGeometry.visualViewportHeight + 1);
    expect(modalGeometry.modalScrollTop).toBe(0);
    expect(modalGeometry.modalTopLeftRadius).not.toBe('0px');
    expect(modalGeometry.modalBottomLeftRadius).toBe('0px');
    expect(modalGeometry.pageWidth).toBeLessThanOrEqual(modalGeometry.viewportWidth + 1);

    await testInfo.attach('bookshelf-add-material-sheet.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });
});
