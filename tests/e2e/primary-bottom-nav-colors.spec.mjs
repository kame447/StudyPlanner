import { expect, test } from '@playwright/test';

async function seedAuthenticatedUser(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'primary-nav-color-user',
      email: 'primary-nav-color@example.com',
      username: 'primary-nav-color',
      avatar: '',
      createdAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function expectActiveNavColorContract(page, label) {
  const metrics = await page.evaluate((expectedLabel) => {
    const nav = document.querySelector('.primary-bottom-nav');
    const buttons = Array.from(nav?.querySelectorAll('button') ?? []);
    const activeButton = buttons.find((button) => button.classList.contains('active'));
    const inactiveButton = buttons.find((button) => !button.classList.contains('active'));
    const circle = activeButton?.querySelector('.home-nav-active-circle');
    const icon = circle?.querySelector('svg');
    const activeLabel = activeButton?.querySelector('span:last-child');
    const inactiveIcon = inactiveButton?.querySelector('svg');

    if (
      !(activeButton instanceof HTMLElement) ||
      !(inactiveButton instanceof HTMLElement) ||
      !(circle instanceof HTMLElement) ||
      !(icon instanceof SVGElement) ||
      !(activeLabel instanceof HTMLElement) ||
      !(inactiveIcon instanceof SVGElement)
    ) {
      throw new Error('primary navigation color audit elements are missing');
    }

    return {
      activeText: activeLabel.textContent?.trim() ?? '',
      activeColor: getComputedStyle(activeButton).color,
      labelColor: getComputedStyle(activeLabel).color,
      circleBackground: getComputedStyle(circle).backgroundColor,
      circleColor: getComputedStyle(circle).color,
      iconColor: getComputedStyle(icon).color,
      iconStroke: getComputedStyle(icon).stroke,
      iconFill: getComputedStyle(icon).fill,
      inactiveColor: getComputedStyle(inactiveButton).color,
      inactiveIconStroke: getComputedStyle(inactiveIcon).stroke,
      expectedLabel,
    };
  }, label);

  expect(metrics.activeText).toBe(label);
  expect(metrics.activeColor).toBe(metrics.circleBackground);
  expect(metrics.labelColor).toBe(metrics.activeColor);
  expect(metrics.circleColor).toBe('rgb(255, 255, 255)');
  expect(metrics.iconColor).toBe('rgb(255, 255, 255)');
  expect(metrics.iconStroke).toBe('rgb(255, 255, 255)');
  expect(metrics.iconFill).toBe('none');
  expect(metrics.inactiveColor).not.toBe(metrics.activeColor);
  expect(metrics.inactiveIconStroke).toBe(metrics.inactiveColor);
}

test('Home, Bookshelf and Timetable use green active chrome with a white outline glyph', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAuthenticatedUser(page);
  await page.goto('/');

  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await expectActiveNavColorContract(page, 'ホーム');

  await page.locator('.primary-bottom-nav button').filter({ hasText: '教材' }).click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
  await expectActiveNavColorContract(page, '教材');

  await page.locator('.primary-bottom-nav button').filter({ hasText: '時間割' }).click();
  await expect(page.locator('.timetable-view')).toBeVisible();
  await expectActiveNavColorContract(page, '時間割');
});
