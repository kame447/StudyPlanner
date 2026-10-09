import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const key = 'study-planner-appearance';
async function seed(page, appearance = null) {
  await page.addInitScript(({ today, appearance }) => {
    if (localStorage.getItem('appearance-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'appearance-user', email: 'appearance@example.test', username: 'テーマ検証', avatar: '', createdAt: now };
    const plan = { id: 'appearance-plan', seriesId: 'appearance-plan', userId: user.id, title: 'テーマ変更後も残る予定',
      subject: '数学', type: 'study', sourceType: 'manual', date: today, startTime: '14:00', endTime: '15:00',
      memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    if (appearance !== null) localStorage.setItem('study-planner-appearance', appearance);
    localStorage.setItem('appearance-seeded', 'true');
  }, { today: E2E_TODAY, appearance });
}
async function settings(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
}
async function fontSettled(page) { await page.evaluate(() => document.fonts.ready); }
async function dotReady(page) {
  await expect.poll(() => page.locator('.settings-field-label').first().evaluate(e => getComputedStyle(e).fontFamily)).toContain('DotGothic16');
  await fontSettled(page);
}
async function appearanceSnapshot(page) {
  return page.locator('.app-settings-page').evaluate(root => {
    document.activeElement?.blur();
    const properties = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'backgroundImage',
      'borderRadius', 'borderWidth', 'borderColor', 'boxShadow', 'display', 'position', 'padding', 'margin', 'gap', 'overflow'];
    return [root, ...root.querySelectorAll('*')].map(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { tag: element.tagName, class: element.getAttribute('class'),
        style: Object.fromEntries(properties.map(property => [property, style[property]])),
        rect: [rect.x, rect.y, rect.width, rect.height] };
    });
  });
}

for (const width of [320, 390, 844, 1280]) test.describe(`appearance viewport ${width}`, () => {
  // Mobile WebKit requires the intended CSS viewport at context creation;
  // resizing an already-open mobile page is not a physical rotation guarantee.
  const viewport = { width, height: width === 844 ? 390 : 844 };
  test.use({ viewport, screen: viewport });
  test(`optional appearance keyboard, reload and exact standard restoration at ${width}px`, async ({ page }, testInfo) => {
    const fonts = [], optionalStyles = [];
    page.on('request', request => {
      if (/DotGothic16/.test(request.url())) fonts.push(request.url());
      if (/appearance-pixel-.*\.css/.test(request.url())) optionalStyles.push(request.url());
    });
    await seed(page); await page.goto('/');
    await expect.poll(() => page.evaluate(width => ({
      inner: innerWidth, client: document.documentElement.clientWidth,
      visual: Math.round(visualViewport.width), exactMedia: matchMedia(`(width: ${width}px)`).matches,
    }), width)).toEqual({ inner: width, client: width, visual: width, exactMedia: true });
    await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
    await settings(page); await fontSettled(page);
    expect(fonts).toEqual([]); expect(optionalStyles).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
    const before = await appearanceSnapshot(page);
    const plans = await page.evaluate(() => localStorage.getItem('studyplanner.plans'));
    const pixel = page.getByRole('button', { name: 'ドット', exact: true });
    await pixel.focus(); await page.keyboard.press('Enter');
    await expect(pixel).toHaveAttribute('aria-pressed', 'true'); await dotReady(page);
    expect(fonts).toHaveLength(1); expect(optionalStyles).toHaveLength(1);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
    expect(await page.locator('.settings-field-label').first().evaluate(e => getComputedStyle(e).fontFamily)).toContain('DotGothic16');
    expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
    expect(await page.locator('.app-settings-content').evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false);
    await testInfo.attach(`pixel-settings-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.reload();
    await expect(pixel).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
    // Repeated native control activation preserves the most recent choice.
    const standard = page.getByRole('button', { name: '標準', exact: true });
    for (const button of [standard, pixel, standard, pixel, standard]) await button.click();
    await fontSettled(page);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
    expect(await appearanceSnapshot(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.plans'))).toBe(plans);
    await standard.focus(); await page.keyboard.press('Space');
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('.home-today-panel')).toContainText('テーマ変更後も残る予定');
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
  });
});

for (const mode of ['ライト', 'ダーク']) test(`dot appearance follows all palettes in ${mode} without changing illustration or target areas`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, 'pixel'); await page.goto('/');
  await settings(page); await dotReady(page); await page.getByRole('button', { name: 'ミニマル', exact: true }).click();
  // Keep a real mode transition in each independently bounded palette case.
  await page.getByRole('button', { name: mode === 'ライト' ? 'ダーク' : 'ライト', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode === 'ライト' ? 'dark' : 'light');
  const results = [];
  for (const palette of ['フォレスト', 'オーシャン', 'サクラ', 'アンバー', 'バイオレット']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode === 'ライト' ? 'light' : 'dark');
    const disclosure = page.locator('[aria-controls="settings-palette-options"]');
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
    await page.getByRole('button', { name: palette, exact: true }).click();
    await expect(page.getByRole('button', { name: 'ミニマル', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '戻る', exact: true }).click(); await fontSettled(page);
    const measured = await page.evaluate(() => {
      const button = document.querySelector('.home-start-button'), hero = document.querySelector('.home-next-card');
      const style = getComputedStyle(button), decor = getComputedStyle(hero, '::after');
      const rgb = color => { const c = document.createElement('canvas'); c.width = c.height = 1;
        const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3).map(x => x / 255); };
      const lum = color => rgb(color).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const [light, dark] = [lum(style.color), lum(style.backgroundColor)].sort((a, b) => b - a);
      const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { contrast: (light + .05) / (dark + .05), hit: button === hit || button.contains(hit),
        decorPointerEvents: decor.pointerEvents, bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scene: localStorage.getItem('study-planner-home-scene-style') };
    });
    expect(measured.contrast).toBeGreaterThanOrEqual(4.5); expect(measured.hit).toBe(true);
    expect(measured.decorPointerEvents).toBe('none'); expect(measured.bodyOverflow).toBe(false); expect(measured.scene).toBe('minimal');
    results.push({ mode, palette, ...measured });
    if (palette === 'フォレスト') await testInfo.attach(`pixel-home-${mode}`, { body: await page.screenshot(), contentType: 'image/png' });
    await settings(page);
  }
  await testInfo.attach('palette-evidence', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});

test('blocked font keeps the app usable and never blocks startup or standard restoration', async ({ page }) => {
  await page.route('**/fonts/DotGothic16-Regular.woff2', route => route.abort('failed'));
  await seed(page, 'pixel'); await page.goto('/'); await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
  await settings(page); await page.getByRole('button', { name: '標準', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
  await page.getByRole('button', { name: '戻る', exact: true }).click(); await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
});

test('a font response arriving after standard selection cannot revive the dot theme', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/fonts/DotGothic16-Regular.woff2', async route => { await gate; await route.continue(); });
  await seed(page, 'pixel'); await page.goto('/', { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible(); await settings(page);
    await page.getByRole('button', { name: '標準', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
  } finally { release(); }
  await fontSettled(page); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
  expect(await page.locator('.settings-field-label').first().evaluate(e => getComputedStyle(e).fontFamily)).not.toContain('DotGothic16');
});

test('appearance storage failure retains the last saved selection and recovers', async ({ page }) => {
  await seed(page); await page.goto('/'); await settings(page);
  await page.evaluate(() => {
    window.__appearanceWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === 'study-planner-appearance') throw new DOMException('blocked', 'QuotaExceededError');
      return window.__appearanceWrite.call(this, name, value); };
  });
  await page.getByRole('button', { name: 'ドット', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('テーマを保存できませんでした');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.evaluate(() => { Storage.prototype.setItem = window.__appearanceWrite; });
  await page.getByRole('button', { name: 'ドット', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
});


test('failed optional style download is announced while standard remains available', async ({ page }) => {
  await page.route('**/assets/appearance-pixel-*.css', route => route.abort('failed'));
  await seed(page); await page.goto('/'); await settings(page);
  await page.getByRole('button', { name: 'ドット', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ドットテーマを読み込めませんでした');
  await page.getByRole('button', { name: '標準', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
});

test('late optional CSS cannot alter the standard appearance', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/appearance-pixel-*.css', async route => { await gate; await route.continue(); });
  await seed(page); await page.goto('/'); await settings(page);
  const before = await appearanceSnapshot(page);
  try {
    await page.getByRole('button', { name: 'ドット', exact: true }).click();
    await page.getByRole('button', { name: '標準', exact: true }).click();
  } finally { release(); }
  await expect.poll(() => page.evaluate(() => [...document.styleSheets].some(s => s.href?.includes('appearance-pixel')))).toBe(true);
  expect(await appearanceSnapshot(page)).toEqual(before);
});

test('reselecting a failed optional style keeps the reload error visible', async ({ page }) => {
  await page.route('**/assets/appearance-pixel-*.css', route => route.abort('failed'));
  await seed(page); await page.goto('/'); await settings(page);
  await page.getByRole('button', { name: 'ドット', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ドットテーマを読み込めませんでした');
  await page.getByRole('button', { name: '標準', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'ドット', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('画面を再読み込み');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
});

test('reselecting a pending optional style observes its eventual failure', async ({ page }) => {
  let release, requested = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/appearance-pixel-*.css', async route => { requested = true; await gate; await route.abort('failed'); });
  await seed(page); await page.goto('/'); await settings(page);
  try {
    await page.getByRole('button', { name: 'ドット', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await page.getByRole('button', { name: '標準', exact: true }).click();
    await page.getByRole('button', { name: 'ドット', exact: true }).click();
  } finally { release(); }
  await expect(page.getByRole('alert')).toContainText('ドットテーマを読み込めませんでした');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
});
