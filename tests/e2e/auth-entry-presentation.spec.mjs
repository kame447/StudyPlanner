import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const AUTH_URL = 'http://127.0.0.1:4174/?scenario=auth';
const icon = fs.readFileSync(new URL('../../public/icons/laplans-192.png', import.meta.url));
const pixelStyles = fs.readFileSync(new URL('../../src/styles/appearance-pixel.css', import.meta.url), 'utf8');
const font = fs.readFileSync(new URL('../../public/fonts/DotGothic16-Regular.woff2', import.meta.url));

async function openAuth(page, { theme = 'light', pixel = false } = {}) {
  await page.route('**/icons/laplans-192.png', route => route.fulfill({ contentType: 'image/png', body: icon }));
  await page.route('**/fonts/DotGothic16-Regular.woff2', route => route.fulfill({ contentType: 'font/woff2', body: font }));
  await page.goto(AUTH_URL);
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
  await page.evaluate(({ theme, pixel }) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = pixel ? 'pixel' : 'standard';
  }, { theme, pixel });
  // Exercise the real optional paint rules even when they load after entry CSS.
  if (pixel) await page.addStyleTag({ content: pixelStyles });
  await expect(page.locator('.brand-mark')).toHaveJSProperty('naturalWidth', 192);
}

for (const width of [320, 390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`login and registration share a readable dark canvas at ${width}px with saved ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await openAuth(page, { theme });
      const login = page.getByRole('tab', { name: 'ログイン', exact: true });
      const signUp = page.getByRole('tab', { name: '新規会員登録', exact: true });
      await expect(login).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 1, name: 'ログイン', exact: true })).toHaveCount(1);
      await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await login.getAttribute('id'));
      expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of ['html', 'body', '.auth-entry-shell']) {
        await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(6, 9, 20)');
      }
      const left = await login.boundingBox(); const right = await signUp.boundingBox();
      expect(left.y).toBe(right.y); expect(right.x).toBeGreaterThan(left.x);
      expect(left.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByLabel('メールアドレス')).toHaveCSS('font-size', '16px');
      await expect(page.getByLabel('パスワード', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
      await expect(page.getByLabel('パスワード確認')).toHaveCount(0);
      await expect(page.locator('.brand-mark')).toHaveCSS('filter', 'none');
      expect(await page.locator('.brand-mark').evaluate(element => {
        const style = getComputedStyle(element);
        return style.maskImage || style.webkitMaskImage;
      })).toContain('radial-gradient');
      await info.attach(`login-${width}-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      await signUp.click();
      await expect(signUp).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 1, name: '新規会員登録', exact: true })).toHaveCount(1);
      await expect(page.getByLabel('パスワード確認')).toBeVisible();
      await expect(page.getByLabel('パスワード', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
      await expect(page.getByRole('button', { name: '登録して確認メールを送る' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await info.attach(`registration-${width}-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
}

test('registration fits a standard phone screen with the motion control visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openAuth(page);
  await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();
  await expect(page.getByLabel('パスワード確認')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const toggle = await page.getByRole('button', { name: '星の動きを止める' }).boundingBox();
  expect(toggle.y + toggle.height).toBeLessThanOrEqual(844);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 390, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 900 },
]) {
  test(`brand and modes stay anchored across mode and error changes at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAuth(page);
    const brand = page.locator('.auth-entry-brand');
    const modes = page.locator('.auth-entry-modes');
    const initialBrand = await brand.boundingBox();
    const initialModes = await modes.boundingBox();
    expect(initialBrand).not.toBeNull();
    expect(initialModes).not.toBeNull();

    async function expectAnchorsUnchanged() {
      // Submitting on short screens scrolls the button into view; compare at the same scroll position.
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      for (const [locator, initial] of [[brand, initialBrand], [modes, initialModes]]) {
        const current = await locator.boundingBox();
        expect(current).not.toBeNull();
        expect(Math.abs(current.x - initial.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(current.y - initial.y)).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    await expectAnchorsUnchanged();
    const signIn = page.getByRole('tab', { name: 'ログイン', exact: true });
    const signUp = page.getByRole('tab', { name: '新規会員登録', exact: true });
    await signUp.click();
    await expect(signUp).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('パスワード確認')).toBeVisible();
    await expectAnchorsUnchanged();
    await signIn.click();
    await expect(signIn).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('パスワード確認')).toHaveCount(0);
    await expectAnchorsUnchanged();

    await signUp.click();
    await expect(signUp).toHaveAttribute('aria-selected', 'true');
    await expectAnchorsUnchanged();
    await page.getByLabel('メールアドレス').fill('layout@example.test');
    await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
    await page.getByLabel('パスワード確認').fill('different12');
    await page.getByRole('button', { name: '登録して確認メールを送る' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectAnchorsUnchanged();
    await signIn.click();
    await expect(signIn).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectAnchorsUnchanged();
  });
}


test('late pixel appearance keeps the auth canvas, input contrast, and compact modes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAuth(page, { theme: 'light', pixel: true });
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(6, 9, 20)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(6, 9, 20)');
  await expect(page.getByLabel('メールアドレス')).toHaveCSS('background-color', 'rgb(16, 21, 34)');
  await expect(page.getByLabel('メールアドレス')).toHaveCSS('color', 'rgb(244, 246, 251)');
  await expect(page.getByRole('button', { name: 'ログインする' })).toHaveCSS('background-color', 'rgb(224, 231, 245)');
  await expect(page.getByRole('button', { name: 'ログインする' })).toHaveCSS('color', 'rgb(17, 23, 37)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('login-pixel', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('stars drift with native CSS animation and can be paused without changing the form', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openAuth(page);
  await page.getByLabel('メールアドレス').fill('kept@example.test');
  const layer = page.locator('.auth-stars__layer--near');
  await expect(layer).toHaveCSS('animation-name', 'auth-star-drift');
  await expect(layer).toHaveCSS('animation-play-state', 'running');
  const initial = await layer.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => layer.evaluate(element => getComputedStyle(element).transform)).not.toBe(initial);
  await page.getByRole('button', { name: '星の動きを止める', exact: true }).click();
  await expect(layer).toHaveCSS('animation-play-state', 'paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(layer).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-motion-toggle')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(layer).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: '星の動きを再開', exact: true }).click();
  await expect(layer).toHaveCSS('animation-play-state', 'running');
  await expect(page.getByLabel('メールアドレス')).toHaveValue('kept@example.test');
});

test('switching modes clears passwords and errors, while reset and Google stay reachable', async ({ page }) => {
  await openAuth(page);
  await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();
  await page.getByLabel('メールアドレス').fill('retained@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
  await page.getByLabel('パスワード確認').fill('different12');
  await page.getByRole('button', { name: '登録して確認メールを送る' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('メールアドレス')).toHaveValue('retained@example.test');
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'パスワードを再設定' }).click();
  await page.getByRole('button', { name: 'Googleでログイン' }).click();
  expect(await page.evaluate(() => window.__quickEntryEvents.filter(event => event.type.startsWith('auth-')))).toEqual([
    { type: 'auth-password-reset', payload: { email: 'retained@example.test' } },
    { type: 'auth-google-sign-in', payload: null },
  ]);
});

for (const viewport of [
  { width: 320, height: 568 }, { width: 360, height: 640 },
  { width: 375, height: 667 }, { width: 430, height: 760 },
  { width: 390, height: 480, largeText: true },
]) {
  test(`auth anchors and natural scroll at ${viewport.width}x${viewport.height}${viewport.largeText ? ' 200% text' : ''}`, async ({ page }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAuth(page);
    if (viewport.largeText) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const measure = () => page.evaluate(() => Object.fromEntries(['.auth-entry-brand', '.auth-entry-modes'].map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return [selector, { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }];
    })));
    const baseline = await measure(); const evidence = [];
    for (const mode of ['新規会員登録', 'ログイン', '新規会員登録']) {
      await page.getByRole('tab', { name: mode, exact: true }).click();
      const rects = await measure(); evidence.push({ mode, rects });
      for (const selector of Object.keys(baseline)) for (const key of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(rects[selector][key] - baseline[selector][key])).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    for (const action of [page.getByRole('button', { name: '登録して確認メールを送る' }), page.getByRole('link', { name: 'プライバシーポリシー', exact: true })]) {
      await action.focus(); await action.scrollIntoViewIfNeeded();
      const reach = await action.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, viewport: innerHeight, focused: document.activeElement === node,
          hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      });
      expect(reach.focused).toBe(true); expect(reach.hit).toBe(true);
      expect(reach.top).toBeGreaterThanOrEqual(-1); expect(reach.bottom).toBeLessThanOrEqual(reach.viewport + 1);
      evidence.push({ reach });
    }
    await info.attach('auth-anchor-scroll.json', { body: Buffer.from(JSON.stringify({ viewport, baseline, evidence })), contentType: 'application/json' });
  });
}

for (const { width, level } of [{ width: 390, level: 'standard' }, { width: 1280, level: 'standard' },
  { width: 390, level: 'reduced' }, { width: 390, level: 'off' }]) {
  test(`auth form-only fade preserves nodes and focus at ${width}px ${level}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: level === 'reduced' ? 'reduce' : 'no-preference' });
    await page.addInitScript(level => {
      localStorage.setItem('study-planner-motion', level === 'off' ? 'off' : 'standard');
      const frames = [], entries = [], ids = new WeakMap(); let nextId = 1, active = true, phase = 'initial', raf;
      const id = node => { if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node); };
      const started = event => {
        if (!event.target.matches?.('.auth-entry-panel')) return;
        const style = getComputedStyle(event.target);
        const animation = event.target.getAnimations().find(a => a.animationName === event.animationName);
        const rules = [...document.styleSheets].filter(s => !s.href || new URL(s.href).origin === location.origin)
          .flatMap(s => [...s.cssRules]).filter(r => r.type === CSSRule.KEYFRAMES_RULE && r.name === event.animationName)
          .map(r => [...new Set([...r.cssRules].flatMap(k => [...k.style]))].sort());
        entries.push({ phase, t: performance.now(), name: event.animationName, duration: style.animationDuration, rules,
          liveProperties: animation ? [...new Set(animation.effect.getKeyframes().flatMap(k => Object.keys(k)))].filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)).sort() : null });
      };
      document.addEventListener('animationstart', started, true);
      const tick = () => {
        if (!active) return;
        const nodes = Object.fromEntries(['.auth-entry-brand', '.auth-entry-modes', '.auth-entry-panel', 'input[name=email]'].map(selector => {
          const node = document.querySelector(selector); if (!node) return [selector, null];
          const r = node.getBoundingClientRect(), s = getComputedStyle(node);
          return [selector, { id: id(node), x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height,
            opacity: Number(s.opacity), transform: s.transform, translate: s.translate, scale: s.scale, animationName: s.animationName }];
        }));
        if (nodes['.auth-entry-panel']) frames.push({ phase, t: performance.now(), nodes });
        if (frames.length < 3000) raf = requestAnimationFrame(tick);
      };
      window.__authFade = { frames, entries, arm(next) { phase = next; }, stop() { active = false; cancelAnimationFrame(raf); document.removeEventListener('animationstart', started, true); } };
      raf = requestAnimationFrame(tick);
    }, level);
    try {
      await openAuth(page);
      const panel = page.getByRole('tabpanel');
      const duration = level === 'standard' ? '0.3s' : level === 'reduced' ? '0.12s' : '0s';
      const settle = async phase => {
        await expect(page.locator('html')).toHaveAttribute('data-motion', level);
        await expect(panel).toHaveCSS('animation-duration', duration);
        await expect.poll(() => panel.evaluate(node => node.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
        await expect(panel).toHaveCSS('opacity', '1');
        await expect.poll(() => page.evaluate(phase => {
          const frames = window.__authFade.frames.filter(f => f.phase === phase);
          return frames.length >= 8 && frames.at(-1).t - frames[0].t >= 120;
        }, phase)).toBe(true);
      };
      await settle('initial');
      // ElementHandles, not serialized objects, verify actual DOM identity.
      const panelNode = await panel.elementHandle(); const emailNode = await page.getByLabel('メールアドレス').elementHandle();
      for (const [phase, key, name] of [['signup', 'End', '新規会員登録'], ['login', 'Home', 'ログイン'], ['signup-again', 'End', '新規会員登録']]) {
        await page.getByRole('tab', { selected: true }).focus();
        await page.evaluate(phase => window.__authFade.arm(phase), phase);
        await page.keyboard.press(key);
        await expect(page.getByRole('tab', { name, exact: true })).toBeFocused();
        await settle(phase);
        expect(await panelNode.evaluate(node => node === document.querySelector('.auth-entry-panel'))).toBe(true);
        expect(await emailNode.evaluate(node => node === document.querySelector('input[name=email]'))).toBe(true);
      }
      await page.evaluate(() => window.__authFade.arm('typing-error'));
      const starts = await page.evaluate(() => window.__authFade.entries.length);
      await page.getByLabel('メールアドレス').fill('motion@example.test');
      await page.getByLabel('パスワード', { exact: true }).fill('synthetic-password');
      await page.getByLabel('パスワード確認').fill('different-password');
      await page.getByRole('button', { name: '登録して確認メールを送る' }).click();
      await expect(page.getByRole('alert')).toContainText('一致していません');
      await settle('typing-error');
      expect(await page.evaluate(() => window.__authFade.entries.length)).toBe(starts);
      const evidence = await page.evaluate(() => ({ frames: window.__authFade.frames, entries: window.__authFade.entries }));
      const opacityCapture = ['initial', 'signup', 'login', 'signup-again'].map(phase => ({
        phase, partialFrames: evidence.frames.filter(f => f.phase === phase && f.nodes['.auth-entry-panel'].opacity > 0 && f.nodes['.auth-entry-panel'].opacity < 1).length,
      }));
      await info.attach('auth-fade-opacity-capture.json', { body: Buffer.from(JSON.stringify({ level, phases: opacityCapture })), contentType: 'application/json' });
      // An individual short phase can miss intermediate paints under CI load;
      // retain that zero explicitly, but never accept switching with no painted fade.
      if (level !== 'off') expect(opacityCapture.filter(phase => phase.phase !== 'initial').reduce((sum, phase) => sum + phase.partialFrames, 0)).toBeGreaterThan(0);
      const baseline = evidence.frames[0].nodes;
      for (const frame of evidence.frames) {
        for (const selector of ['.auth-entry-brand', '.auth-entry-modes']) {
          const node = frame.nodes[selector];
          expect(node.id).toBe(baseline[selector].id); expect(node.opacity).toBe(1); expect(node.animationName).toBe('none');
          for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(node[key] - baseline[selector][key])).toBeLessThanOrEqual(1);
        }
        const node = frame.nodes['.auth-entry-panel'];
        expect(node.transform).toBe('none'); expect(['none', '0px', '0px 0px']).toContain(node.translate); expect(['none', '1', '1 1']).toContain(node.scale);
      }
      if (level !== 'off') for (const phase of ['initial', 'signup', 'login', 'signup-again']) {
        expect(evidence.entries.filter(e => e.phase === phase)).toHaveLength(1);
      }
      for (const entry of evidence.entries) {
        expect(entry.duration).toBe(duration); expect(entry.rules.length).toBeGreaterThan(0);
        entry.rules.forEach(properties => expect(properties).toEqual(['opacity']));
        if (entry.liveProperties) expect(entry.liveProperties).toEqual(['opacity']);
      }
      if (level === 'off') expect(evidence.frames.every(f => f.nodes['.auth-entry-panel'].opacity === 1)).toBe(true);
    } finally {
      const evidence = await page.evaluate(() => { window.__authFade.stop(); return { frames: window.__authFade.frames, entries: window.__authFade.entries }; });
      expect(evidence.frames.length).toBeLessThan(3000);
      await info.attach('auth-form-fade-frames.json', { body: Buffer.from(JSON.stringify({ width, level, evidence })), contentType: 'application/json' });
    }
  });
}
