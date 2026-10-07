import { expect, test } from '@playwright/test';

const FIXED_NOW = new Date('2026-08-22T09:00:00Z');
const FIXED_TODAY = '2026-08-22';

const CASES = [
  {
    name: 'study',
    type: 'study',
    sourceType: 'manual',
    title: 'アルゴリズム演習',
    expected: 'study',
  },
  {
    name: 'class',
    type: 'study',
    sourceType: 'timetable',
    title: '情報資源総論',
    expected: 'class',
  },
  {
    name: 'other',
    type: 'other',
    sourceType: 'manual',
    title: '部屋の掃除',
    expected: 'other',
  },
];

async function seedHome(page, planCase, theme, style = 'pixel') {
  await page.addInitScript(({ planCase: seed, today, createdAt, theme, style }) => {
    if (sessionStorage.getItem('home-scene-seeded')) return;
    sessionStorage.setItem('home-scene-seeded', 'true');
    localStorage.setItem('study-planner-home-scene-style', style);
    localStorage.setItem('study-planner-theme-mode', theme);
    const user = {
      id: 'home-visual-user',
      email: 'home-visual@example.com',
      username: 'home-visual-user',
      avatar: '',
      createdAt,
    };
    const plan = {
      id: `home-visual-${seed.name}`,
      seriesId: `home-visual-${seed.name}`,
      userId: user.id,
      title: seed.title,
      subject: '情報科学',
      type: seed.type,
      sourceType: seed.sourceType,
      date: today,
      startTime: '13:30',
      endTime: '15:00',
      memo: '',
      recurrence: null,
      createdAt,
      updatedAt: createdAt,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  }, {
    planCase,
    today: FIXED_TODAY,
    createdAt: FIXED_NOW.toISOString(),
    theme,
    style,
  });
}

const STYLES = [
  { id: 'pixel', label: 'ピクセル' },
  { id: 'cozy', label: 'イラスト' },
  { id: 'minimal', label: 'ミニマル' },
  { id: 'pixel-cat', label: 'ピクセル・猫' },
  { id: 'pixel-turtle', label: 'ピクセル・亀' },
];

const COMPANION_ANIMATIONS = {
  'pixel-cat': {
    'home-scene-cat-tail': 'home-scene-cat-tail-sway',
    'home-scene-cat-head': 'home-scene-cat-nod',
    'home-scene-cat-eyes': 'home-scene-cat-blink',
  },
  'pixel-turtle': {
    'home-scene-turtle-walk': 'home-scene-turtle-stroll',
    'home-scene-turtle-leg-front': 'home-scene-turtle-step',
    'home-scene-turtle-leg-back': 'home-scene-turtle-step',
    'home-scene-turtle-head': 'home-scene-turtle-peek',
  },
};
const ANIMATED_PART_SELECTOR = [
  'home-scene-cloud', 'home-scene-steam', 'home-scene-glint',
  ...Object.values(COMPANION_ANIMATIONS).flatMap(parts => Object.keys(parts)),
].map(className => `.${className}`).join(', ');

async function openSettings(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  return page.locator('.app-settings-page');
}

async function animationNames(scene) {
  return scene.locator(ANIMATED_PART_SELECTOR)
    .evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
}

async function expectStillArtwork(scene) {
  const parts = scene.locator(ANIMATED_PART_SELECTOR);
  expect(await parts.count()).toBeGreaterThan(0);
  await expect.poll(() => animationNames(scene)).toEqual(Array(await parts.count()).fill('none'));
  await expect.poll(() => scene.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
}

async function expectCompanionAnimations(scene, style, enabled) {
  for (const [className, animationName] of Object.entries(COMPANION_ANIMATIONS[style] ?? {})) {
    const part = scene.locator(`.${className}`);
    await expect(part).toHaveCount(1);
    await expect(part).toHaveCSS('animation-name', enabled ? animationName : 'none');
    if (!enabled) continue;
    await expect.poll(() => part.evaluate(element => element.getAnimations()
      .some(animation => animation.playState === 'running'))).toBe(true);
    // Seek each real CSS animation to representative frames, then resume it.
    // This proves visible transform changes without a slow, timing-sensitive sleep.
    const transforms = await part.evaluate(element => {
      const animation = element.getAnimations()[0];
      const originalTime = animation.currentTime;
      const duration = Number(animation.effect.getTiming().duration);
      animation.pause();
      try {
        return [0, .5, .85, .935].map(progress => {
          animation.currentTime = duration * progress;
          return getComputedStyle(element).transform;
        });
      } finally {
        animation.currentTime = originalTime;
        animation.play();
      }
    });
    expect(new Set(transforms).size, `${className} changes its rendered transform`).toBeGreaterThan(1);
  }
}

async function artworkGeometry(scene) {
  return scene.locator('svg').evaluate(svg => JSON.stringify(
    [...svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, g[transform]')]
      .map(element => ({
        element: element.tagName,
        attributes: [...element.attributes]
          .filter(attribute => ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
            'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke', 'stroke-width'].includes(attribute.name))
          .map(attribute => [attribute.name, attribute.value]),
      })),
  ));
}

test.describe('home next-plan code-rendered scenes', () => {
  test.use({ timezoneId: 'UTC' });

  for (const planCase of CASES) for (const style of STYLES) for (const theme of ['light', 'dark']) {
    test(`${style.id}: ${planCase.expected} in ${theme}, including theme switches`, async ({ page }, testInfo) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await seedHome(page, planCase, theme, style.id);
      const imageRequests = [];
      page.on('request', request => {
        if (request.url().includes('/assets/home/')) imageRequests.push(request.url());
      });
      await page.goto('/');
      const card = page.locator('.home-next-card');
      const scene = card.locator('.home-study-scene');
      await expect(card).not.toHaveAttribute('data-next-plan-semantic', 'empty');
      await expect(card).toHaveAttribute('data-next-plan-visual', planCase.expected);
      await expect(scene).toHaveAttribute('data-scene-style', style.id);
      await expect(scene).toHaveAttribute('data-scene-kind', planCase.expected);
      await expect(scene).toHaveAttribute('aria-hidden', 'true');
      await expect(scene).toHaveAttribute('data-scene-motion', 'off');
      await expect(scene.locator('svg')).toBeVisible();
      await expect(scene.locator(`[data-scene-art="${style.id}"]`)).toBeVisible();
      await expect(scene.locator('img, image')).toHaveCount(0);
      const originalGeometry = await card.boundingBox();
      expect(originalGeometry.width).toBeGreaterThan(250);
      expect(originalGeometry.height).toBeGreaterThan(100);
      const sceneBox = await scene.boundingBox();
      expect(sceneBox.width).toBeGreaterThan(90);
      expect(sceneBox.height).toBeGreaterThan(70);
      if (COMPANION_ANIMATIONS[style.id]) {
        const companion = scene.locator('[data-scene-companion]');
        await expect(companion).toBeVisible();
        const companionBox = await companion.boundingBox();
        expect(companionBox.x).toBeGreaterThanOrEqual(sceneBox.x - .5);
        expect(companionBox.y).toBeGreaterThanOrEqual(sceneBox.y - .5);
        expect(companionBox.x + companionBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + .5);
        expect(companionBox.y + companionBox.height).toBeLessThanOrEqual(sceneBox.y + sceneBox.height + .5);
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const initialColor = await scene.evaluate(element => getComputedStyle(element).getPropertyValue('--scene-wall'));
      const otherTheme = theme === 'light' ? 'dark' : 'light';
      for (const mode of [otherTheme, theme]) {
        const settings = await openSettings(page);
        await settings.getByRole('button', { name: mode === 'dark' ? 'ダーク' : 'ライト', exact: true }).click();
        await settings.getByRole('button', { name: '戻る', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        await expect(scene.locator('svg')).toBeVisible();
        const color = await scene.evaluate(element => getComputedStyle(element).getPropertyValue('--scene-wall'));
        if (mode === theme) expect(color).toBe(initialColor);
        else expect(color).not.toBe(initialColor);
      }
      const currentGeometry = await card.boundingBox();
      expect(Math.abs(currentGeometry.height - originalGeometry.height)).toBeLessThan(1);
      expect(Math.abs(currentGeometry.width - originalGeometry.width)).toBeLessThan(1);
      await expectStillArtwork(scene);
      await expectCompanionAnimations(scene, style.id, false);
      expect(imageRequests).toEqual([]);
      await testInfo.attach(`home-${style.id}-${planCase.expected}-${theme}`, {
        body: await card.screenshot(), contentType: 'image/png',
      });
      if (planCase.expected === 'study' && theme === 'light') {
        await testInfo.attach(`home-layout-${style.id}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      }
    });
  }

  test('style and motion can be changed with the keyboard and survive closing, navigation and reload', async ({ page }, testInfo) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedHome(page, CASES[0], 'light');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const scene = page.locator('.home-next-card .home-study-scene');
    const initialBox = await page.locator('.home-next-card').boundingBox();
    let settings = await openSettings(page);
    const drawingsByStyle = new Map();
    for (const style of [...STYLES, STYLES[1]]) {
      const option = settings.getByRole('button', { name: style.label, exact: true });
      await option.focus();
      await page.keyboard.press('Enter');
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      await expect(scene).toHaveAttribute('data-scene-style', style.id);
      const drawing = await artworkGeometry(scene);
      if (drawingsByStyle.has(style.id)) expect(drawing).toBe(drawingsByStyle.get(style.id));
      drawingsByStyle.set(style.id, drawing);
    }
    expect(new Set(drawingsByStyle.values()).size).toBe(5);
    const motion = settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true });
    await expect(motion).not.toBeChecked();
    await motion.focus(); await page.keyboard.press('Space');
    await expect(motion).toBeChecked();
    await expect(scene).toHaveAttribute('data-scene-motion', 'on');
    await expect.poll(() => animationNames(scene)).toContain('home-scene-cloud-drift');
    await testInfo.attach('home-scene-settings', { body: await settings.screenshot(), contentType: 'image/png' });
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    settings = await openSettings(page);
    await expect(settings.getByRole('button', { name: 'イラスト', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true })).toBeChecked();
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    const navigation = page.getByRole('navigation', { name: '主要ナビゲーション' });
    await navigation.getByRole('button', { name: '予定', exact: true }).click();
    await expect(scene).toHaveCount(0);
    await navigation.getByRole('button', { name: 'ホーム', exact: true }).click();
    await expect(scene).toHaveAttribute('data-scene-style', 'cozy');
    await page.reload();
    await expect(scene).toHaveAttribute('data-scene-style', 'cozy');
    await expect(scene).toHaveAttribute('data-scene-motion', 'on');
    const box = await page.locator('.home-next-card').boundingBox();
    expect(Math.abs(box.height - initialBox.height)).toBeLessThan(1);
    expect(Math.abs(box.width - initialBox.width)).toBeLessThan(1);
    expect(await page.evaluate(() => localStorage.getItem('study-planner-home-scene-style'))).toBe('cozy');
    expect(await page.evaluate(() => localStorage.getItem('study-planner-home-scene-motion'))).toBe('true');

    // OS accessibility preference always wins, without changing the saved choice.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expectStillArtwork(scene);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => animationNames(scene)).toContain('home-scene-cloud-drift');
    settings = await openSettings(page);
    await settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true }).uncheck();
    await expectStillArtwork(scene);
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await page.reload();
    await expect(scene).toHaveAttribute('data-scene-motion', 'off');
  });

  for (const companion of ['pixel-cat', 'pixel-turtle']) {
    test(`${companion} animates only when enabled and respects reduced motion`, async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await seedHome(page, CASES[0], 'light', companion);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      const scene = page.locator('.home-next-card .home-study-scene');
      await expect(scene).toHaveAttribute('data-scene-style', companion);
      await expectStillArtwork(scene);
      await expectCompanionAnimations(scene, companion, false);
      let settings = await openSettings(page);
      await settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true }).check();
      for (const style of STYLES) {
        const preview = settings.locator(`.home-scene-preview[data-scene-style="${style.id}"]`);
        await expectStillArtwork(preview);
        await expectCompanionAnimations(preview, style.id, false);
      }
      await settings.getByRole('button', { name: '戻る', exact: true }).click();
      await expect(scene).toBeVisible();
      await expectCompanionAnimations(scene, companion, true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expectStillArtwork(scene);
      await expectCompanionAnimations(scene, companion, false);
      expect(await page.evaluate(() => localStorage.getItem('study-planner-home-scene-motion'))).toBe('true');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expectCompanionAnimations(scene, companion, true);
      settings = await openSettings(page);
      await settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true }).uncheck();
      await settings.getByRole('button', { name: '戻る', exact: true }).click();
      await expectStillArtwork(scene);
      await expectCompanionAnimations(scene, companion, false);
      await page.reload();
      await expect(scene).toHaveAttribute('data-scene-style', companion);
      await expect(scene).toHaveAttribute('data-scene-motion', 'off');
      await expectStillArtwork(scene);
      await expectCompanionAnimations(scene, companion, false);
    });
  }

  test('reduced motion prevents every style from animating even when enabled', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedHome(page, CASES[0], 'dark');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const scene = page.locator('.home-next-card .home-study-scene');
    const settings = await openSettings(page);
    await settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true }).check();
    for (const style of STYLES) {
      await settings.getByRole('button', { name: style.label, exact: true }).click();
      await expect(scene).toHaveAttribute('data-scene-style', style.id);
      await expectStillArtwork(scene);
      await expectCompanionAnimations(scene, style.id, false);
      expect(await settings.locator('.home-scene-preview').evaluateAll(elements => elements.every(element => element.dataset.sceneMotion === 'off'))).toBe(true);
    }
  });
});
