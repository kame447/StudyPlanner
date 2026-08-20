import { expect, test } from '@playwright/test';
import {
  expectOrderedWithoutOverlap,
  expectRectContained,
} from './support/layout-containment.mjs';

const VIEWPORTS = [
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'compact-phone', width: 360, height: 640 },
  { name: 'modern-phone', width: 390, height: 844 },
  { name: 'large-phone', width: 430, height: 932 },
  { name: 'wide-devtools', width: 768, height: 710 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'compact-laptop', width: 1366, height: 768 },
  { name: 'desktop-short', width: 1536, height: 864 },
  { name: 'desktop-reference', width: 1440, height: 900 },
  { name: 'desktop-full-hd', width: 1920, height: 1080 },
  { name: 'desktop-qhd', width: 2560, height: 1440 },
  { name: 'tablet-portrait', width: 1024, height: 1366 },
];

const RESIZE_SEQUENCE = [
  { width: 360, height: 640 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

async function seedHome(page, planCount) {
  await page.addInitScript(({ count }) => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'home-containment-user',
      email: 'home-containment@example.com',
      username: 'home-containment-user',
      avatar: '',
      createdAt: now,
    };
    const slots = [
      ['09:00', '09:40'],
      ['10:00', '10:40'],
      ['11:00', '11:40'],
      ['13:00', '13:40'],
    ];
    const plans = Array.from({ length: count }, (_, index) => ({
      id: `home-containment-plan-${index + 1}`,
      seriesId: `home-containment-plan-${index + 1}`,
      userId: user.id,
      title: `情報資源総論 ${index + 1}`,
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: slots[index]?.[0] ?? '14:00',
      endTime: slots[index]?.[1] ?? '14:40',
      memo: '',
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    }));
    const material = {
      id: 'home-containment-material',
      userId: user.id,
      name: '基本情報技術者テキスト',
      subjectId: 'home-containment-subject',
      subjectName: '情報科学',
      status: 'active',
      progressUnit: 'page',
      totalUnits: 300,
      currentUnit: 45,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(plans));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  }, { count: planCount });
}

async function readContainmentMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const serializeRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };

    const home = document.querySelector('.home-dashboard-default');
    const topbar = document.querySelector('.home-topbar');
    const nextCard = document.querySelector('.home-next-card');
    const nextMeta = document.querySelector('.home-next-meta');
    const startButton = document.querySelector('.home-start-button');
    const today = document.querySelector('.home-today-panel');
    const heading = today?.querySelector('.home-section-heading') ?? null;
    const schedule = today?.querySelector('.home-schedule-list') ?? null;
    const attention = document.querySelector('.home-alert-grid');
    const progress = document.querySelector('.home-progress-panel');
    const nav = document.querySelector('.home-bottom-nav');
    const material = [...document.querySelectorAll('.home-material-panel')].find(visible) ?? null;
    const scheduleStyle = schedule ? getComputedStyle(schedule) : null;
    const todayStyle = today ? getComputedStyle(today) : null;

    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      home: serializeRect(home),
      topbar: serializeRect(topbar),
      nextCard: serializeRect(nextCard),
      nextMeta: serializeRect(nextMeta),
      startButton: serializeRect(startButton),
      today: serializeRect(today),
      heading: serializeRect(heading),
      schedule: serializeRect(schedule),
      attention: serializeRect(attention),
      progress: serializeRect(progress),
      material: serializeRect(material),
      nav: serializeRect(nav),
      todayDisplay: todayStyle?.display ?? null,
      scheduleOverflowY: scheduleStyle?.overflowY ?? null,
    };
  });
}

function expectContainment(metrics) {
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.pageHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.todayDisplay).toBe('grid');
  expect(['auto', 'scroll']).toContain(metrics.scheduleOverflowY);

  expectRectContained(metrics.today, metrics.heading);
  expectRectContained(metrics.today, metrics.schedule);

  expectOrderedWithoutOverlap(metrics.topbar, metrics.nextCard);
  if (metrics.nextMeta && metrics.startButton) {
    expect(metrics.nextMeta.bottom).toBeLessThanOrEqual(metrics.startButton.top - 2);
  }
  expectOrderedWithoutOverlap(metrics.nextCard, metrics.today);
  expectOrderedWithoutOverlap(metrics.today, metrics.attention);
  expectOrderedWithoutOverlap(metrics.attention, metrics.progress);
  expectOrderedWithoutOverlap(metrics.progress, metrics.material);

  const lastContent = metrics.material ?? metrics.progress;
  if (lastContent && metrics.nav) {
    expect(lastContent.bottom).toBeLessThanOrEqual(metrics.nav.top + 1);
  }
}

for (const viewport of VIEWPORTS) {
  for (const planCount of [1, 4]) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} keeps ${planCount} schedule row(s) inside today's card`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedHome(page, planCount);
      await page.goto('/');
      await expect(page.locator('.home-dashboard-default')).toBeVisible();
      await page.waitForTimeout(650);

      expectContainment(await readContainmentMetrics(page));
    });
  }
}

test('keeps containment while resizing between phone, laptop, desktop, and tablet layouts', async ({ page }) => {
  await page.setViewportSize(RESIZE_SEQUENCE[0]);
  await seedHome(page, 4);
  await page.goto('/');
  await expect(page.locator('.home-dashboard-default')).toBeVisible();

  for (const viewport of RESIZE_SEQUENCE) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(450);
    expectContainment(await readContainmentMetrics(page));
  }
});
