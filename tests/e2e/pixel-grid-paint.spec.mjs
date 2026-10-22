import { expect, test } from './support/fixed-clock.mjs';

// Compare the old root overdraw with the served candidate in the same real app.
// Visible body/shell/settings gradients are never replaced with a tiled image.
async function paint(page, original) {
  return page.evaluate(async original => {
    const root = document.documentElement;
    if (original) root.style.setProperty('background', 'var(--pixel-grid-paper), var(--pixel-canvas)', 'important');
    else root.style.removeProperty('background');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const selectors = ['html', 'body', '.app-shell', '.app-settings-page', '.app-settings-header', '.app-settings-tabs'];
    const geometry = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { selector, rect: [rect.x, rect.y, rect.width, rect.height],
        scroll: [element.scrollLeft, element.scrollTop], font: style.font,
        color: style.backgroundColor, image: selector === 'html' ? null : style.backgroundImage,
        size: selector === 'html' ? null : style.backgroundSize,
        position: selector === 'html' ? null : style.backgroundPosition,
        repeat: selector === 'html' ? null : style.backgroundRepeat };
    }));
    const body = document.body.getBoundingClientRect();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return { geometry, rootImage: getComputedStyle(root).backgroundImage,
      dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], rootFont: getComputedStyle(root).fontSize,
      body: { top: body.top, left: body.left, right: body.right, bottom: body.bottom,
        alpha: context.getImageData(0, 0, 1, 1).data[3] } };
  }, original);
}

async function pixelDifference(page, left, right) {
  return page.evaluate(async ([left, right]) => {
    async function decode(base64) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    }
    const a = await decode(left), b = await decode(right);
    if (a.width !== b.width || a.height !== b.height) return { sameDimensions: false, changedPixels: null };
    let changedPixels = 0;
    for (let index = 0; index < a.pixels.length; index += 4) {
      if (a.pixels[index] !== b.pixels[index] || a.pixels[index + 1] !== b.pixels[index + 1]
        || a.pixels[index + 2] !== b.pixels[index + 2] || a.pixels[index + 3] !== b.pixels[index + 3]) changedPixels++;
    }
    return { sameDimensions: true, width: a.width, height: a.height, changedPixels };
  }, [left.toString('base64'), right.toString('base64')]);
}

for (const width of [390, 1920]) for (const dpr of [1.5, 3]) {
  test.describe(`pixel root overdraw ${width}px DPR ${dpr}`, () => {
    const viewport = { width, height: width === 1920 ? 1080 : 844 };
    test.use({ viewport, screen: viewport, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
    for (const theme of ['light', 'dark']) for (const percent of [100, 200])
      for (const surface of ['home', 'settings']) for (const geometry of ['actual', 'fractional'])
        for (const position of ['top', 'scrolled']) {
          test(`${theme} ${percent}% ${surface} ${geometry} ${position}: exact original RGBA`, async ({ page }, testInfo) => {
            await page.addInitScript(theme => {
              const user = { id: 'pixel-paint-user', email: 'pixel-paint@example.test', username: '描画検証', avatar: '', createdAt: '2026-08-19T01:00:00Z' };
              localStorage.setItem('studyplanner.users', JSON.stringify([user]));
              localStorage.setItem('studyplanner.session', user.id);
              for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
              localStorage.setItem('study-planner-appearance', 'pixel');
              localStorage.setItem('study-planner-theme-mode', theme);
            }, theme);
            await page.goto('/');
            await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
            if (surface === 'settings') {
              await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
              await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
            }
            await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await expect(page.locator('html')).toHaveCSS('background-image', 'none');
            await expect.poll(() => page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
            await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
            expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
            await page.evaluate(({ percent, surface, geometry, position }) => {
              document.documentElement.style.fontSize = `${percent}%`;
              const root = document.querySelector(surface === 'settings' ? '.app-settings-page' : '.app-shell');
              if (geometry === 'fractional') {
                const rect = root.getBoundingClientRect();
                root.style.width = `${Math.floor(rect.width / 8) * 8 - 3.5}px`;
                root.style.height = `${Math.floor(rect.height / 8) * 8 - 2.5}px`;
                root.style.translate = '0.5px 0.5px'; root.style.minHeight = '0';
              }
              if (position === 'scrolled') {
                const container = document.querySelector(surface === 'settings' ? '.app-settings-content' : '.app-shell');
                const tail = document.createElement('div'); tail.setAttribute('aria-hidden', 'true');
                tail.style.cssText = `min-height:${innerHeight * 2}px;flex-shrink:0;grid-column:1/-1`;
                container.append(tail); container.style.overflowY = 'auto';
                container.style.maxHeight = `${innerHeight - 1}px`; container.scrollTop = 32;
              }
            }, { percent, surface, geometry, position });
            const admission = await page.evaluate(surface => {
              const rect = document.querySelector(surface === 'settings' ? '.app-settings-page' : '.app-shell').getBoundingClientRect();
              return { rect: [rect.x, rect.y, rect.width, rect.height], scrolls: [...document.querySelectorAll('*')].filter(element => element.scrollTop > 0).length };
            }, surface);
            if (geometry === 'fractional') expect(admission.rect.every(value => value % 1 !== 0)).toBe(true);
            if (position === 'scrolled') expect(admission.scrolls).toBeGreaterThan(0);

            const before = await paint(page, true), a = await page.screenshot();
            const after = await paint(page, false), b = await page.screenshot();
            const restored = await paint(page, true), a2 = await page.screenshot();
            await paint(page, false);
            const stability = await pixelDifference(page, a, a2), comparison = await pixelDifference(page, a, b);
            await testInfo.attach('root-grid-paint-comparison', { body: JSON.stringify({ admission, before, after, restored, stability, comparison }), contentType: 'application/json' });
            for (const [name, body] of [['original-root-grid', a], ['candidate-root-canvas', b], ['original-root-grid-repeat', a2]]) await testInfo.attach(name, { body, contentType: 'image/png' });
            expect(before.rootImage.match(/repeating-linear-gradient/g)).toHaveLength(2);
            expect(after.rootImage).toBe('none');
            expect(after.geometry).toEqual(before.geometry); expect(restored).toEqual(before);
            expect(after.dpr).toBe(dpr); expect(after.viewport).toEqual([viewport.width, viewport.height]);
            expect(after.rootFont).toBe(`${16 * percent / 100}px`);
            expect(after.body.alpha).toBe(255);
            expect(after.body.top).toBeLessThanOrEqual(0); expect(after.body.left).toBeLessThanOrEqual(0);
            expect(after.body.right).toBeGreaterThanOrEqual(viewport.width); expect(after.body.bottom).toBeGreaterThanOrEqual(viewport.height);
            expect(stability.sameDimensions).toBe(true); expect(stability.changedPixels, 'Original must repeat exactly').toBe(0);
            expect(comparison.sameDimensions).toBe(true); expect(comparison.changedPixels, 'Removing obscured root paint must preserve every pixel').toBe(0);
          });
        }
  });
}
