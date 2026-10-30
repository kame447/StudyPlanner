import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const roots = {
  home: '.home-main > .home-dashboard[aria-label="ホーム"]',
  month: 'main.section-stack > .schedule-month-view',
  week: 'main.section-stack > .schedule-week-view',
  day: 'main.section-stack > .swipe-view',
  todo: 'main.section-stack > .todo-view',
  bookshelf: 'main.section-stack > .bookshelf-view',
  report: 'main.section-stack > .learning-report-view',
  timetable: 'main.section-stack > .timetable-view',
  ai: '.home-main > .ai-planning-view-shell-v2 > .ai-planning-view:not([hidden])',
};
const nav = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true });

for (const { width, level } of [{ width: 390, level: 'standard' }, { width: 1280, level: 'standard' },
  { width: 390, level: 'reduced' }, { width: 390, level: 'off' }]) {
  for (const scenario of ['route entries and retained state', 'rapid navigation and overlays']) {
  test(`primary body fade ${width}px ${level}: ${scenario}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: level === 'reduced' ? 'reduce' : 'no-preference' });
    await page.addInitScript(({ today, level, roots }) => {
      const now = '2026-10-29T00:00:00Z';
      const user = { id: 'entry-fade-owner', email: 'entry@example.test', username: 'Entry fixture', avatar: '', createdAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      localStorage.setItem('study-planner-motion', level === 'off' ? 'off' : 'standard');
      localStorage.setItem('study-planner-font-preset', 'system');
      localStorage.setItem('studyplanner.plans', JSON.stringify([{ id: 'entry-plan', seriesId: 'entry-plan', userId: user.id,
        title: '合成の学習予定', subject: '数学', type: 'study', sourceType: 'manual', date: today,
        startTime: '14:00', endTime: '15:00', memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now }]));
      for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
      // Keep the ordinary flowing fake clock: pausing it before mount would stop
      // Home's real rAF fitter as well as the intended animation observation.
      const samples = [], entries = [], ids = new WeakMap(); let nextId = 1, phase = 'initial', active = true, frame;
      const id = node => { if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node); };
      const started = event => {
        const route = Object.entries(roots).find(([, selector]) => event.target.matches?.(selector));
        if (!route || event.animationName !== 'ui-surface-fade') return;
        const style = getComputedStyle(event.target);
        const animation = event.target.getAnimations().find(a => a.animationName === event.animationName);
        // A queued animationstart can arrive after a short CSSAnimation is no
        // longer returned by getAnimations(). Require the actual loaded rule,
        // and retain the live effect as additional evidence when still present.
        const declaredKeyframes = [...document.styleSheets]
          .filter(sheet => !sheet.href || new URL(sheet.href).origin === location.origin)
          .flatMap(sheet => [...sheet.cssRules])
          .filter(rule => rule.type === CSSRule.KEYFRAMES_RULE && rule.name === event.animationName)
          .map(rule => ({ properties: [...new Set([...rule.cssRules].flatMap(frame => [...frame.style]))].sort(),
            opacities: [...rule.cssRules].map(frame => frame.style.getPropertyValue('opacity')) }));
        entries.push({ phase, route: route[0], id: id(event.target), t: performance.now(), pending: event.target.hasAttribute('data-initial-layout-pending'),
          duration: style.animationDuration, delay: style.animationDelay, fill: style.animationFillMode, declaredKeyframes, liveEffectAvailable: Boolean(animation),
          properties: animation ? [...new Set(animation.effect.getKeyframes().flatMap(f => Object.keys(f)))].filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)).sort() : [] });
      };
      document.addEventListener('animationstart', started, true);
      const tick = () => {
        if (!active) return;
        for (const [route, selector] of Object.entries(roots)) {
          const node = document.querySelector(selector);
          if (!node?.getClientRects().length) continue;
          const style = getComputedStyle(node), rect = node.getBoundingClientRect();
          const chrome = ['.app-shell', '.primary-app-header', '.primary-bottom-nav'].map(selector => {
            const el = document.querySelector(selector); if (!el) return null;
            const s = getComputedStyle(el), r = el.getBoundingClientRect(), matrix = new DOMMatrixReadOnly(s.transform);
            return { selector, opacity: s.opacity, transform: s.transform, matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], x: r.x, y: r.y, width: r.width, height: r.height };
          });
          samples.push({ phase, route, id: id(node), t: performance.now(), opacity: Number(style.opacity), transform: style.transform,
            overlayOpen: Boolean(node.querySelector('.ai-chat-drawer-layer')), visible: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), pending: node.hasAttribute('data-initial-layout-pending'),
            x: rect.x, y: rect.y, width: rect.width, chrome });
        }
        if (samples.length < 6000) frame = requestAnimationFrame(tick);
      };
      window.__entryFade = { samples, entries, arm(name) { phase = name; }, stop() { active = false; cancelAnimationFrame(frame); document.removeEventListener('animationstart', started, true); } };
      frame = requestAnimationFrame(tick);
    }, { today: E2E_TODAY, level, roots });

    async function settled(route, phase, action) {
      if (action) { await page.evaluate(name => window.__entryFade.arm(name), phase); await action(); }
      const body = page.locator(roots[route]);
      await expect(body).toBeVisible();
      await expect(body).not.toHaveAttribute('data-initial-layout-pending');
      const css = await body.evaluate(node => { const s = getComputedStyle(node); return { name: s.animationName, duration: s.animationDuration, delay: s.animationDelay, fill: s.animationFillMode }; });
      expect(css).toEqual({ name: 'ui-surface-fade', duration: level === 'off' ? '0s' : level === 'reduced' ? '0.12s' : '0.15s', delay: '0s', fill: 'backwards' });
      // Only completion is awaited here; the recorder has already captured from
      // before the click, including transparent/partial-opacity entry frames.
      await expect.poll(() => body.evaluate(node => node.getAnimations().filter(a => a.animationName === 'ui-surface-fade').length)).toBe(0);
      await expect(body).toHaveCSS('opacity', '1');
      await expect.poll(() => page.evaluate(({ route, phase }) => window.__entryFade.samples.filter(s => s.route === route && s.phase === phase && s.visible && !s.pending).length, { route, phase })).toBeGreaterThan(0);
      const data = await page.evaluate(({ route, phase }) => ({ samples: window.__entryFade.samples.filter(s => s.route === route && s.phase === phase), entries: window.__entryFade.entries.filter(e => e.route === route && e.phase === phase) }), { route, phase });
      if (level !== 'off') {
        expect(data.entries).toHaveLength(1);
        expect(data.entries[0].declaredKeyframes.length).toBeGreaterThan(0);
        for (const rule of data.entries[0].declaredKeyframes) {
          expect(rule.properties).toEqual(['opacity']);
          expect(rule.opacities).toEqual(['0', '1']);
        }
        if (data.entries[0].liveEffectAvailable) expect(data.entries[0].properties).toEqual(['opacity']);
        expect(data.entries[0].pending).toBe(false);
      }
      for (const sample of data.samples) {
        expect(sample.transform).toBe('none');
        for (const chrome of sample.chrome.filter(Boolean)) {
          expect(chrome.opacity).toBe('1');
          if (chrome.selector === '.primary-bottom-nav') {
            // Existing fixed navigation is centered with translateX(-50%).
            // Permit only that static translation, never entry motion.
            expect(chrome.matrix.slice(0, 4)).toEqual([1, 0, 0, 1]);
            expect(chrome.matrix[5]).toBe(0);
            expect(Math.abs(chrome.matrix[4] + chrome.width / 2)).toBeLessThanOrEqual(0.01);
            expect(chrome.transform).toBe(data.samples[0].chrome.find(c => c?.selector === '.primary-bottom-nav').transform);
          } else expect(chrome.transform).toBe('none');
        }
      }
      const visible = data.samples.filter(s => s.visible && !s.pending);
      expect(new Set(visible.map(s => s.id)).size).toBe(1);
      for (const dimension of ['x', 'y', 'width']) expect(Math.max(...visible.map(s => s[dimension])) - Math.min(...visible.map(s => s[dimension]))).toBeLessThanOrEqual(1);
      const bars = visible.map(s => s.chrome.find(c => c?.selector === '.primary-bottom-nav'));
      expect(bars.every(Boolean)).toBe(true);
      for (const dimension of ['x', 'y', 'width', 'height']) expect(Math.max(...bars.map(b => b[dimension])) - Math.min(...bars.map(b => b[dimension]))).toBeLessThanOrEqual(1);
      return body;
    }
    try {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-motion', level);
      await settled('home', 'initial');
      if (scenario === 'route entries and retained state') {
      const routeRounds = level === 'standard' ? ['cold', 'warm'] : ['preference'];
      let aiNode;
      for (const round of routeRounds) {
        await settled('month', `${round}-month`, () => nav(page, '予定').click());
        for (const [route, label] of [['week', '週'], ['day', '日'], ['todo', 'Todo']]) {
          await settled(route, `${round}-${route}`, () => page.getByRole('tablist', { name: '予定表示' }).getByRole('tab', { name: label, exact: true }).click());
        }
        await settled('bookshelf', `${round}-bookshelf`, () => nav(page, '教材').click());
        await settled('timetable', `${round}-timetable`, () => nav(page, '時間割').click());
        const ai = await settled('ai', `${round}-ai`, () => nav(page, 'AI計画').click());
        if (aiNode) expect(await aiNode.evaluate(node => node === document.querySelector('.ai-planning-view-shell-v2 > .ai-planning-view'))).toBe(true);
        else aiNode = await ai.elementHandle();
        await settled('home', `${round}-home`, () => nav(page, 'ホーム').click());
        await settled('report', `${round}-report`, () => page.locator('.home-progress-panel').getByRole('button', { name: '詳細を見る', exact: true }).click());
        await settled('home', `${round}-report-home`, () => nav(page, 'ホーム').click());
      }
      } else {
      // Do not wait for either route's fade before the next real tap.
      await page.evaluate(() => window.__entryFade.arm('rapid'));
      await nav(page, '時間割').click();
      await nav(page, 'AI計画').click();
      await nav(page, 'ホーム').click();
      await expect(nav(page, 'ホーム')).toHaveAttribute('aria-current', 'page');
      await expect(nav(page, 'ホーム')).toBeFocused();
      await expect(page.getByRole('navigation', { name: '主要ナビゲーション' }).locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.locator(roots.home)).toBeVisible();
      await expect(page.locator(roots.home)).not.toHaveAttribute('inert');
      // A retained AI drawer can open during entry. Guarding the overlay must
      // end only this entry fade, not replay it when the drawer closes.
      await page.evaluate(() => window.__entryFade.arm('ai-overlay'));
      await nav(page, 'AI計画').click();
      await page.getByRole('button', { name: 'チャット一覧を開く', exact: true }).click();
      const ai = page.locator(roots.ai);
      await expect(ai).toHaveCSS('animation-duration', '0s');
      const starts = await page.evaluate(() => window.__entryFade.entries.filter(e => e.phase === 'ai-overlay').length);
      await page.evaluate(() => window.__entryFade.arm('ai-overlay-close'));
      await page.getByRole('button', { name: 'チャット一覧を閉じる', exact: true }).click();
      await expect(page.locator('.ai-chat-drawer-layer')).toHaveCount(0);
      await expect(ai).toHaveCSS('opacity', '1');
      expect(await page.evaluate(() => window.__entryFade.entries.filter(e => e.phase === 'ai-overlay').length)).toBe(starts);
      await expect.poll(() => page.evaluate(() => window.__entryFade.samples.filter(s => s.phase === 'ai-overlay-close' && s.route === 'ai' && !s.overlayOpen).length)).toBeGreaterThanOrEqual(2);
      const closed = await page.evaluate(() => ({ frames: window.__entryFade.samples.filter(s => s.phase === 'ai-overlay-close' && s.route === 'ai' && !s.overlayOpen), entries: window.__entryFade.entries.filter(e => e.phase === 'ai-overlay-close') }));
      expect(closed.entries).toEqual([]);
      expect(closed.frames.every(frame => frame.opacity === 1)).toBe(true);
      }
      expect(await page.evaluate(() => window.__entryFade.samples.length), 'Recorder cap means incomplete evidence').toBeLessThan(6000);
    } finally {
      const evidence = await page.evaluate(() => { window.__entryFade.stop(); return { samples: window.__entryFade.samples, entries: window.__entryFade.entries }; }).catch(() => null);
      await testInfo.attach('route-entry-fade-frames.json', { body: Buffer.from(JSON.stringify({ width, level, scenario, evidence })), contentType: 'application/json' });
    }
  });
}
}
