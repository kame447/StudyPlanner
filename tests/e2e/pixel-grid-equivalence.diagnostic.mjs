// Diagnostic gate, not a replacement for the unchanged material behavior tests.
import { expect, test } from './support/fixed-clock.mjs';

const original = 'repeating-linear-gradient(0deg, transparent 0 7px, var(--pixel-grid) 7px 8px), repeating-linear-gradient(90deg, transparent 0 7px, var(--pixel-grid) 7px 8px)';
const candidate = 'repeating-linear-gradient(0deg, transparent 0 7px, var(--pixel-grid) 7px 8px) left top / 1px 100% repeat, repeating-linear-gradient(90deg, transparent 0 7px, var(--pixel-grid) 7px 8px) left top / 100% 1px repeat';
const consumers = 'html, body, .app-shell, .app-settings-page, .app-settings-header, .app-settings-tabs';

async function paint(page, value) {
  return page.evaluate(async ({ value, consumers }) => {
    document.documentElement.style.setProperty('--pixel-grid-paper', value);
    const elements = [...document.querySelectorAll(consumers)];
    // Flush style so the real CSS transitions exist before waiting. Two frames
    // alone were insufficient for body's existing 200ms background transition.
    for (const element of elements) void getComputedStyle(element).backgroundPosition;
    const pending = elements.flatMap(element => element.getAnimations().filter(animation =>
      animation instanceof CSSTransition && animation.playState !== 'finished' && animation.playState !== 'idle'));
    const observed = pending.map(animation => ({ property: animation.transitionProperty,
      state: animation.playState, endTime: animation.effect.getComputedTiming().endTime }));
    if (observed.some(item => !Number.isFinite(item.endTime) || item.endTime > 1000))
      throw new Error('Unexpected unbounded or >1s consumer transition; refusing unsettled pixel comparison');
    // Do not cancel, finish, disable or fast-forward animations. The unchanged
    // overall 30s test budget bounds actual completion, including paused clocks.
    await Promise.all(pending.map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (elements.some(element => element.getAnimations().some(animation =>
      animation instanceof CSSTransition && animation.playState !== 'finished' && animation.playState !== 'idle')))
      throw new Error('Consumer transition remains active after settling');
    (window.__pixelGridTransitionEvidence ??= []).push({ value, observed, settled: true });
    return elements.map(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { tag: element.tagName, class: element.className, rect: [rect.x, rect.y, rect.width, rect.height],
        font: style.fontFamily, fontSize: style.fontSize, origin: style.backgroundOrigin, clip: style.backgroundClip,
        paint: { image: style.backgroundImage, position: style.backgroundPosition, size: style.backgroundSize, repeat: style.backgroundRepeat },
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        borderStyle: style.borderStyle, borderColor: style.borderColor,
        scroll: [element.scrollLeft, element.scrollTop] };
    });
  }, { value, consumers });
}

// Decode with the same browser's PNG decoder. Compare RGBA, not compressed PNG
// bytes or Playwright's perceptual threshold. Canvas is detached from the app.
async function difference(page, left, right) {
  return page.evaluate(async ([left, right]) => {
    async function decode(base64) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    }
    const a = await decode(left), b = await decode(right);
    if (a.width !== b.width || a.height !== b.height) return { sameDimensions: false, changedPixels: null };
    let changedPixels = 0; const box = [a.width, a.height, -1, -1];
    for (let index = 0; index < a.pixels.length; index += 4) {
      if ([0, 1, 2, 3].some(channel => a.pixels[index + channel] !== b.pixels[index + channel])) {
        changedPixels++; const x = (index / 4) % a.width, y = Math.floor(index / 4 / a.width);
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      }
    }
    return { sameDimensions: true, width: a.width, height: a.height, changedPixels, boundingBox: changedPixels ? box : null };
  }, [left.toString('base64'), right.toString('base64')]);
}

for (const width of [390, 1920]) test.describe(`grid ${width}px`, () => {
  const viewport = { width, height: width === 1920 ? 1080 : 844 };
  test.use({ viewport, screen: viewport, deviceScaleFactor: 3 });
  for (const theme of ['light', 'dark']) for (const percent of [100, 200])
    for (const surface of ['home', 'settings']) for (const geometry of ['actual', 'fractional'])
      for (const position of ['top', 'scrolled']) {
        test(`${theme} ${percent}% ${surface} ${geometry} ${position}: exact original/tile pixels`, async ({ page }, testInfo) => {
          await page.addInitScript(theme => {
            const user = { id: 'grid-user', email: 'grid@example.test', username: 'グリッド検証', avatar: '', createdAt: '2026-08-19T01:00:00Z' };
            localStorage.setItem('studyplanner.users', JSON.stringify([user]));
            localStorage.setItem('studyplanner.session', user.id);
            for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
            localStorage.setItem('study-planner-appearance', 'pixel'); localStorage.setItem('study-planner-theme-mode', theme);
          }, theme);
          await page.goto('/');
          await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
          if (surface === 'settings') {
            await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
            await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
          }
          await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect.poll(() => page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
          for (const selector of (surface === 'settings' ? ['html', 'body', '.app-settings-page', '.app-settings-header', '.app-settings-tabs'] : ['html', 'body', '.app-shell'])) await expect(page.locator(selector)).toHaveCount(1);
          await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
          expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
          // Reject an unexpected source rather than silently testing a stale candidate.
          const declaredGrid = await page.evaluate(() => {
            const values = [];
            const visit = rules => { for (const rule of rules) {
              const value = rule.style?.getPropertyValue('--pixel-grid-paper'); if (value) values.push(value);
              if (rule.cssRules) visit(rule.cssRules);
            } };
            for (const sheet of document.styleSheets) visit(sheet.cssRules);
            return values;
          });
          expect(declaredGrid.map(value => value.replace(/\s+/g, ''))).toEqual([candidate.replace(/\s+/g, '')]);
          await page.evaluate(({ percent, geometry, surface, position }) => {
            document.documentElement.style.fontSize = `${percent}%`;
            if (geometry === 'fractional') {
              const root = document.querySelector(surface === 'settings' ? '.app-settings-page' : '.app-shell');
              const rect = root.getBoundingClientRect();
              root.style.width = `${Math.floor(rect.width / 8) * 8 - 3.5}px`;
              root.style.height = `${Math.floor(rect.height / 8) * 8 - 2.5}px`;
              root.style.translate = '0.5px 0.5px'; root.style.minHeight = '0';
            }
            if (position === 'scrolled') {
              // A bounded inert tail guarantees scrolling even when the empty
              // seeded page fits. This is a diagnostic fixture, not app CSS.
              const container = document.querySelector(surface === 'settings' ? '.app-settings-content' : '.app-shell');
              const tail = document.createElement('div'); tail.setAttribute('aria-hidden', 'true');
              tail.style.cssText = `min-height:${innerHeight * 2}px;flex-shrink:0;grid-column:1/-1`;
              container.append(tail); container.style.overflowY = 'auto';
              container.style.maxHeight = `${innerHeight - 1}px`; container.scrollTop = 32;
            }
          }, { percent, geometry, surface, position });
          const admission = await page.evaluate(({ surface, geometry, percent }) => {
            const root = document.querySelector(surface === 'settings' ? '.app-settings-page' : '.app-shell'), rect = root.getBoundingClientRect();
            return { dpr: devicePixelRatio, innerWidth, rootFont: getComputedStyle(document.documentElement).fontSize, x: rect.x, y: rect.y, width: rect.width, height: rect.height, expectedPercent: percent, geometry, scrolls: [...document.querySelectorAll('*')].filter(e => e.scrollTop > 0).map(e => ({ tag: e.tagName, class: e.className, top: e.scrollTop })) };
          }, { surface, geometry, percent });
          expect(admission.dpr).toBe(3); expect(admission.innerWidth).toBe(width); expect(admission.rootFont).toBe(`${16 * percent / 100}px`);
          if (geometry === 'fractional') { expect(admission.x % 1).not.toBe(0); expect(admission.y % 1).not.toBe(0); expect(admission.width % 1).not.toBe(0); expect(admission.height % 1).not.toBe(0); expect(admission.width % 8).not.toBe(0); expect(admission.height % 8).not.toBe(0); }
          if (position === 'scrolled') expect(admission.scrolls.length, 'Bounded scroll fixture must actually scroll').toBeGreaterThan(0);
          if (surface === 'settings') {
            for (const selector of ['.app-settings-header', '.app-settings-tabs']) await expect(page.locator(selector)).toBeVisible();
            expect(await page.locator('.app-settings-header').evaluate(e => getComputedStyle(e).borderBottomWidth)).toBe('1px');
            if (width === 390) expect(await page.locator('.app-settings-tabs').evaluate(e => getComputedStyle(e).borderBottomWidth)).toBe('1px');
          }
          const before = await paint(page, original);
          expect(before.every(item => item.paint.position.split(', ').every(position => position === '0% 0%'))).toBe(true);
          const a = await page.screenshot();
          const after = await paint(page, candidate);
          expect(after.every(item => item.paint.position.split(', ').every(position => position === '0% 0%'))).toBe(true);
          const b = await page.screenshot();
          const restored = await paint(page, original), a2 = await page.screenshot();
          for (const [name, body] of [['original', a], ['candidate', b], ['original-repeat', a2]]) await testInfo.attach(name, { body, contentType: 'image/png' });
          const stability = await difference(page, a, a2), comparison = await difference(page, a, b);
          const settlements = await page.evaluate(() => window.__pixelGridTransitionEvidence);
          await testInfo.attach('pixel-comparison', { body: JSON.stringify({ width, theme, percent, surface, geometry, position, admission, settlements, before, after, restored, stability, comparison }), contentType: 'application/json' });
          expect(after.map(({ paint, ...layout }) => layout)).toEqual(before.map(({ paint, ...layout }) => layout)); expect(restored).toEqual(before);
          await page.evaluate(() => document.documentElement.style.removeProperty('--pixel-grid-paper'));
          expect(stability.sameDimensions).toBe(true); expect(stability.changedPixels, 'Original-repeat must be stable').toBe(0);
          expect(comparison.sameDimensions).toBe(true); expect(comparison.changedPixels, 'Tile candidate must preserve every decoded RGBA pixel').toBe(0);
        });
      }
});
