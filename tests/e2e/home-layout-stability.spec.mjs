import { expect, test } from './support/fixed-clock.mjs';

async function seedHome(page, rowCount = 1) {
  await page.addInitScript((rowCount) => {
    const today = new Date().toLocaleDateString('sv-SE');
    const now = new Date().toISOString();
    const user = {
      id: 'home-stability-user',
      email: 'home-stability@example.com',
      username: 'home-stability-user',
      avatar: '',
      createdAt: now,
    };
    const plans = [
      {
        id: 'home-stability-plan',
        seriesId: 'home-stability-plan',
        userId: user.id,
        title: '情報資源総論',
        subject: '情報科学',
        type: 'study',
        date: today,
        startTime: '10:20',
        endTime: '11:50',
        memo: '',
        recurrence: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const material = {
      id: 'home-stability-material',
      userId: user.id,
      name: '基本情報技術者テキスト',
      subjectId: 'home-stability-subject',
      subjectName: '情報科学',
      status: 'active',
      progressUnit: 'page',
      totalUnits: 500,
      currentUnit: 120,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(Array.from({ length: rowCount }, (_, index) => ({ ...plans[0], id: `home-stability-plan-${index}`, seriesId: `home-stability-plan-${index}` }))));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  }, rowCount);
}

async function sampleStableLayout(page) {
  return page.evaluate(async () => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        top: value.top,
        bottom: value.bottom,
        height: value.height,
      };
    };
    const snapshot = () => {
      const dashboard = document.querySelector('.home-main > .home-dashboard-default');
      const materials = [...document.querySelectorAll('.home-material-panel')].filter(visible);
      return {
        href: location.href,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        next: rect('.home-next-card'),
        today: rect('.home-today-panel'),
        attention: rect('.home-alert-grid'),
        progress: rect('.home-progress-panel'),
        nav: rect('.home-bottom-nav'),
        materialCount: materials.length,
        style: dashboard?.getAttribute('style') ?? '',
      };
    };

    const dashboard = document.querySelector('.home-main > .home-dashboard-default');
    let styleMutationCount = 0;
    const observer = dashboard
      ? new MutationObserver((records) => {
          styleMutationCount += records.filter(
            (record) => record.type === 'attributes' && record.attributeName === 'style',
          ).length;
        })
      : null;
    observer?.observe(dashboard, { attributes: true, attributeFilter: ['style'] });

    const samples = [];
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 35));
      samples.push(snapshot());
    }
    observer?.disconnect();

    return { samples, styleMutationCount };
  });
}

function maxSpread(values) {
  const numeric = values.filter((value) => typeof value === 'number');
  if (numeric.length === 0) return 0;
  return Math.max(...numeric) - Math.min(...numeric);
}

function expectStableSamples(result) {
  const { samples, styleMutationCount } = result;
  expect(samples.length).toBeGreaterThan(5);
  expect(new Set(samples.map((sample) => sample.href)).size).toBe(1);
  expect(new Set(samples.map((sample) => sample.materialCount)).size).toBe(1);
  expect(new Set(samples.map((sample) => sample.style)).size).toBeLessThanOrEqual(1);
  expect(styleMutationCount).toBe(0);

  for (const key of ['next', 'today', 'attention', 'progress', 'nav']) {
    expect(maxSpread(samples.map((sample) => sample[key]?.top ?? null))).toBeLessThanOrEqual(0.5);
    expect(maxSpread(samples.map((sample) => sample[key]?.height ?? null))).toBeLessThanOrEqual(0.5);
  }

  for (const sample of samples) {
    expect(sample.pageWidth).toBeLessThanOrEqual(sample.viewportWidth + 1);
    expect(sample.pageHeight).toBeLessThanOrEqual(sample.viewportHeight + 1);
    if (sample.today && sample.attention) {
      expect(sample.today.bottom).toBeLessThanOrEqual(sample.attention.top + 1);
    }
    if (sample.progress && sample.nav) {
      expect(sample.progress.bottom).toBeLessThanOrEqual(sample.nav.top + 1);
    }
  }
}

const REPORTED_AND_THRESHOLD_VIEWPORTS = [
  { name: 'reported-ipad-mini-landscape', width: 1280, height: 800 },
  { name: 'just-below-800', width: 1280, height: 799 },
  { name: 'just-above-800', width: 1280, height: 801 },
  { name: 'compact-tablet', width: 1024, height: 768 },
  { name: 'compact-laptop', width: 1366, height: 768 },
  { name: 'material-threshold', width: 1280, height: 700 },
  { name: 'material-threshold-plus-one', width: 1280, height: 701 },
  { name: 'tall-threshold-minus-one', width: 1280, height: 999 },
  { name: 'tall-threshold', width: 1280, height: 1000 },
  { name: 'tall-threshold-plus-one', width: 1280, height: 1001 },
];

test('home fitter settles and stays stable across tablet/desktop threshold sizes', async ({ page }) => {
  await seedHome(page);
  await page.goto('/');
  await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();

  for (const viewport of REPORTED_AND_THRESHOLD_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(800);
    const result = await sampleStableLayout(page);
    expectStableSamples(result);
  }
});

const ipadMiniUse = {
  viewport: { width: 1280, height: 800 },
  screen: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

test.describe('iPad Mini-like 1280x800 emulation', () => {
  test.use(ipadMiniUse);

  test('does not oscillate after the responsive fitter settles', async ({ page }) => {
    await seedHome(page);
    await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    await page.waitForTimeout(800);

    const result = await sampleStableLayout(page);
    expectStableSamples(result);
  });
});

// Record from document creation, not after the fitter's first visible frames.
for (const variant of [
  { width: 390, rows: 1, colorScheme: 'light', reducedMotion: 'no-preference' },
  { width: 390, rows: 5, colorScheme: 'light', reducedMotion: 'no-preference' },
  { width: 1280, rows: 1, colorScheme: 'light', reducedMotion: 'no-preference' },
  { width: 1280, rows: 5, colorScheme: 'light', reducedMotion: 'no-preference' },
  { width: 390, rows: 1, colorScheme: 'dark', reducedMotion: 'no-preference' },
  { width: 390, rows: 1, colorScheme: 'light', reducedMotion: 'reduce' },
]) {
  test(`Home first visible geometry and AI return ${JSON.stringify(variant)}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: variant.width, height: 844 });
    await page.emulateMedia({ colorScheme: variant.colorScheme, reducedMotion: variant.reducedMotion });
    await seedHome(page, variant.rows);
    await page.addInitScript(mode => localStorage.setItem('study-planner-theme-mode', mode), variant.colorScheme);
    await page.addInitScript(() => {
      const mounts = [];
      let current;
      window.__homeFirstFrames = mounts;
      window.__homeCaptureActive = true;
      const capture = () => {
        if (!window.__homeCaptureActive) return;
        const dashboard = document.querySelector('.home-main > .home-dashboard-default');
        if (dashboard) {
          if (current?.node !== dashboard) {
            current = { node: dashboard, frames: [], pendingInteractive: false };
            mounts.push(current);
          }
          const today = dashboard.querySelector('.home-today-panel');
          const pending = dashboard.hasAttribute('data-initial-layout-pending');
          if (pending && !dashboard.inert) current.pendingInteractive = true;
          if (!pending && !dashboard.inert && today?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
            const frame = {};
            for (const [key, selector] of Object.entries({ today: '.home-today-panel', list: '.home-schedule-list', next: '.home-next-card', header: '.primary-app-header', nav: '.primary-bottom-nav' })) {
              const element = document.querySelector(selector);
              const box = element?.getBoundingClientRect();
              frame[key] = box ? { y: box.y, height: box.height } : null;
            }
            frame.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            current.frames.push(frame);
          }
        }
        requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
    try {
    await page.goto('/');
    const assertFirstMount = async (mountCount) => {
      await expect.poll(() => page.evaluate(() => window.__homeFirstFrames.filter(mount => mount.frames.length >= 20).length)).toBe(mountCount);
      const result = await page.evaluate(() => {
        const mount = window.__homeFirstFrames.at(-1);
        return { frames: mount.frames, pendingInteractive: mount.pendingInteractive };
      });
      expect(result.pendingInteractive).toBe(false);
      await expect(page.locator('.home-main > .home-dashboard-default')).not.toHaveAttribute('data-initial-layout-pending');
      await expect(page.locator('.home-main > .home-dashboard-default')).not.toHaveAttribute('inert');
      for (const key of ['today', 'list', 'next', 'header', 'nav']) {
        expect(result.frames.every(frame => frame[key] !== null), key).toBe(true);
        for (const dimension of ['y', 'height']) {
          expect(maxSpread(result.frames.map(frame => frame[key][dimension])), `${key}.${dimension}`).toBeLessThanOrEqual(1);
        }
      }
      expect(result.frames.every(frame => frame.overflow <= 1)).toBe(true);
      await expect(page.locator('.home-today-panel .home-schedule-row')).toHaveCount(variant.rows);
    };
    await expect(page.locator('.home-today-panel')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.colorScheme);
    await assertFirstMount(1);
    await page.getByRole('navigation').getByRole('button', { name: 'AI計画', exact: true }).click();
    await expect(page.locator('.home-today-panel')).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button', { name: 'ホーム', exact: true }).click();
    await assertFirstMount(2);
    } finally {
      const evidence = await page.evaluate(() => {
        window.__homeCaptureActive = false;
        return window.__homeFirstFrames?.map(({ frames, pendingInteractive }) => ({ frames, pendingInteractive }));
      }).catch(() => null);
      await testInfo.attach('home-first-visible-frames', { body: JSON.stringify({ variant, evidence }), contentType: 'application/json' });
    }
  });
}
