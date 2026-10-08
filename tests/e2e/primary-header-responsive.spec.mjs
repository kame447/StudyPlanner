import { expect, test } from './support/fixed-clock.mjs';

// These are CSS viewport simulations, not physical iPhone/Safari evidence.
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 414, height: 896 },
  { width: 430, height: 932 },
  { width: 700, height: 600 },
  { width: 768, height: 710 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 852, height: 393 },
];
const SURFACES = [
  ['AI計画', '.ai-planning-view'],
  ['予定', '.schedule-main'],
  ['教材', '.bookshelf-view'],
  ['時間割', '.timetable-view'],
  ['ホーム', '.home-main > .home-dashboard-default'],
];

async function seedHeader(page, date = '2026-12-31') {
  await page.clock.setFixedTime(new Date(`${date}T10:00:00+09:00`));
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'responsive-header-user',
      email: 'responsive-header@example.test',
      username: '長い表示名でも日付とメニューを押し出さない利用者',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'responsive-header-plan', seriesId: 'responsive-header-plan', userId: user.id,
      title: '日付看板の表示確認', subject: '数学', type: 'study',
      date: new Date().toLocaleDateString('sv-SE'), startTime: '19:00', endTime: '20:00',
      memo: '', recurrence: null, createdAt: now, updatedAt: now,
    };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function readHeaderBounds(page) {
  return page.locator('.primary-app-header').evaluate((wrapper) => {
    const header = wrapper.querySelector('.home-topbar');
    const plaque = header.querySelector('.home-date-paper');
    const headerBox = header.getBoundingClientRect();
    const plaqueBox = plaque.getBoundingClientRect();
    const violations = [];
    const within = (inner, outer) => inner.left >= outer.left - 0.75
      && inner.right <= outer.right + 0.75
      && inner.top >= outer.top - 0.75 && inner.bottom <= outer.bottom + 0.75;
    const overlaps = (first, second) => first.left < second.right - 0.75
      && second.left < first.right - 0.75
      && first.top < second.bottom - 0.75 && second.top < first.bottom - 0.75;
    const children = [...header.children];
    children.forEach((child, index) => {
      const box = child.getBoundingClientRect();
      if (!within(box, headerBox)) violations.push(`header child ${index} escapes header`);
      children.slice(index + 1).forEach((other, otherIndex) => {
        if (overlaps(box, other.getBoundingClientRect())) {
          violations.push(`header children ${index}/${index + otherIndex + 1} overlap`);
        }
      });
    });
    const texts = [...plaque.querySelectorAll('.home-date-segment')].map(segment => {
      const value = segment.querySelector('.home-date-value');
      const segmentBox = segment.getBoundingClientRect();
      const valueBox = value.getBoundingClientRect();
      // The full text range also detects clipping hidden by overflow:hidden.
      const range = document.createRange();
      range.selectNodeContents(value);
      const textBox = range.getBoundingClientRect();
      const text = value.textContent;
      if (!within(segmentBox, plaqueBox) || !within(valueBox, segmentBox)
        || textBox.left < valueBox.left - 0.75 || textBox.right > valueBox.right + 0.75
        || value.scrollWidth > value.clientWidth + 1) {
        violations.push(`date value ${text} is clipped or outside its cell`);
      }
      return text;
    });
    for (const element of header.querySelectorAll('.home-streak-card span, .home-streak-card strong, .home-streak-card small')) {
      if (!within(element.getBoundingClientRect(), element.closest('.home-streak-card').getBoundingClientRect())) {
        violations.push('streak text escapes card');
      }
    }
    const buttons = [...header.querySelectorAll('button')];
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      if (box.width < 33 || box.height < 33 || !within(box, headerBox)) {
        violations.push(`header button ${button.getAttribute('aria-label')} shrinks or escapes`);
      }
    }
    const viewportWidth = document.documentElement.clientWidth;
    if (headerBox.left < -0.75 || headerBox.right > viewportWidth + 0.75
      || header.scrollWidth > header.clientWidth + 1) violations.push('header overflows viewport');
    const nav = document.querySelector('.primary-bottom-nav');
    const navBox = nav.getBoundingClientRect();
    if (navBox.left < -0.75 || navBox.right > viewportWidth + 0.75
      || nav.scrollWidth > nav.clientWidth + 1) violations.push('navigation overflows viewport');
    const navButtons = [...nav.querySelectorAll('button')];
    if (navButtons.length !== 5 || navButtons.some(button => !within(button.getBoundingClientRect(), navBox))) {
      violations.push('navigation button escapes footer');
    }
    for (const button of navButtons) {
      const label = button.querySelector('span:last-child');
      const range = document.createRange();
      range.selectNodeContents(label);
      if (!within(range.getBoundingClientRect(), button.getBoundingClientRect())) {
        violations.push(`navigation label ${label.textContent} escapes button`);
      }
    }
    return { violations, texts, headerHeight: headerBox.height };
  });
}

async function expectReadableHeader(page, expectedTexts) {
  await expect(page.locator('.home-date-display')).toBeVisible();
  await expect.poll(async () => (await readHeaderBounds(page)).violations).toEqual([]);
  expect((await readHeaderBounds(page)).texts).toEqual(expectedTexts);
}

async function attachScreenshot(testInfo, name, target) {
  const path = testInfo.outputPath(`${name}.png`);
  await target.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}x${viewport.height} keeps the full date and shared controls readable across pages`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await seedHeader(page);
    await page.goto('/');
    await expectReadableHeader(page, ['2026', '12', '31', '木']);
    for (const [label, selector] of SURFACES) {
      await page.locator('.primary-bottom-nav button').filter({ hasText: label }).click();
      await expect(page.locator(selector)).toBeVisible();
      await expectReadableHeader(page, ['2026', '12', '31', '木']);
    }
    if ([320, 393].includes(viewport.width)) {
      await attachScreenshot(testInfo, `header-${viewport.width}`, page.locator('.primary-app-header'));
    }
  });
}

test('393px keeps both digits of September 10 visible without a second header row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await seedHeader(page, '2026-09-10');
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expectReadableHeader(page, ['2026', '9', '10', '木']);
  expect((await readHeaderBounds(page)).headerHeight).toBeLessThan(80);
  await attachScreenshot(testInfo, 'september-10-at-393px', page);
});

for (const width of [320, 393, 768]) {
  test(`${width}px reflows the full header date at 200% text size`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 852 });
    await seedHeader(page);
    await page.goto('/');
    await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
    await expectReadableHeader(page, ['2026', '12', '31', '木']);
    if (width === 320) {
      await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
      await expect(page.locator('.ai-planning-view')).toBeVisible();
      await expectReadableHeader(page, ['2026', '12', '31', '木']);
      const composer = await page.locator('.ai-planning-composer').boundingBox();
      const nav = await page.locator('.primary-bottom-nav').boundingBox();
      expect(composer.y + composer.height).toBeLessThanOrEqual(nav.y + 1);
    }
    await attachScreenshot(testInfo, `header-${width}-text-200`, page.locator('.primary-app-header'));
  });
}

test('393px short AI viewport leaves the date, conversation and input reachable', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 400 });
  await seedHeader(page, '2026-09-10');
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expectReadableHeader(page, ['2026', '9', '10', '木']);
  const textarea = page.locator('.ai-planning-composer textarea');
  await textarea.fill('狭い画面でも入力できる');
  await expect(textarea).toHaveValue('狭い画面でも入力できる');
  const bounds = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const header = rect('.primary-app-header');
    const conversation = rect('.ai-planning-conversation');
    const composer = rect('.ai-planning-composer');
    const nav = rect('.primary-bottom-nav');
    return {
      headerBottom: header.bottom, conversationTop: conversation.top,
      conversationHeight: conversation.height, conversationBottom: conversation.bottom,
      composerTop: composer.top, composerBottom: composer.bottom, navTop: nav.top,
    };
  });
  expect(bounds.conversationTop).toBeGreaterThanOrEqual(bounds.headerBottom);
  expect(bounds.conversationHeight).toBeGreaterThan(0);
  expect(bounds.conversationBottom).toBeLessThanOrEqual(bounds.composerTop + 1);
  expect(bounds.composerBottom).toBeLessThanOrEqual(bounds.navTop + 1);
});
