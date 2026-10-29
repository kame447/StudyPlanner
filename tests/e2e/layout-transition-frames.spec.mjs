import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

// Diagnostic only: synthetic local data, no product fixes or stability threshold waiver.
const variants = [
  { width: 390, rows: 1 }, { width: 390, rows: 5 },
  { width: 1280, rows: 1 }, { width: 1280, rows: 5 },
  { width: 390, rows: 1, mode: 'dark' },
  { width: 390, rows: 1, motion: 'reduce' },
];
for (const { width, rows, mode = 'light', motion = 'no-preference' } of variants) {
  test(`transition frames ${width}px ${rows}rows ${mode} ${motion}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: motion });
    const blockedExternal = [];
    const gates = new Map(['BookshelfView', 'ReportView', 'MonthView', 'WeekView'].map(name => {
      let release; const promise = new Promise(resolve => { release = resolve; });
      return [name, { promise, release, hits: 0, released: false }];
    }));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (url.origin !== 'http://127.0.0.1:4173') {
        blockedExternal.push({ type: route.request().resourceType(), url: '[external URL redacted]' });
        return route.abort('blockedbyclient');
      }
      const name = [...gates.keys()].find(key => new RegExp(`/${key}-[^/]+\\.js$`).test(url.pathname));
      if (name) { const gate = gates.get(name); gate.hits++; await gate.promise; }
      await route.continue();
    });
    await page.addInitScript(({ mode, rows, today }) => {
      // Controlled cold-module leg. Restore native preload before the warm leg.
      const idle = window.requestIdleCallback; const cancelIdle = window.cancelIdleCallback;
      window.requestIdleCallback = () => 1; window.cancelIdleCallback = () => {};
      const user = { id: 'layout-diagnostic-owner', email: 'layout@example.test', username: 'Layout fixture', avatar: '', createdAt: '2026-10-29T00:00:00Z' };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      localStorage.setItem('study-planner-theme-mode', mode);
      localStorage.setItem('study-planner-font-preset', 'system');
      localStorage.setItem('studyplanner.plans', JSON.stringify(Array.from({ length: rows }, (_, i) => ({
        id: `layout-plan-${i}`, seriesId: `layout-plan-${i}`, userId: user.id,
        title: `Synthetic study ${i + 1}`, subject: 'Math', type: 'study', date: today,
        startTime: `${11 + i}:00`, endTime: `${11 + i}:30`, memo: '', recurrence: null,
        createdAt: user.createdAt, updatedAt: user.createdAt,
      }))));
      localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([{
        id: 'layout-material', userId: user.id, name: 'Synthetic material', subjectId: 'math', subjectName: 'Math',
        status: 'active', progressUnit: 'page', totalUnits: 500, currentUnit: 120,
        createdAt: user.createdAt, updatedAt: user.createdAt,
      }]));
      localStorage.setItem('studyplanner.actuals', '[]');
      localStorage.setItem('studyplanner.todos.v1', '[]');
      const selectors = {
        shell: '.app-shell', header: '.primary-app-header', toolbar: '.app-view-switcher',
        main: 'main', dashboard: '.home-dashboard.home-dashboard-default', core: '.home-core-sections', today: '.home-today-panel', list: '.home-schedule-list', row: '.home-schedule-row',
        next: '.home-next-card', nav: '.primary-bottom-nav', schedule: '.schedule-toolbar',
        skeleton: '.route-skeleton', booksHeader: '.bookshelf-page-header', booksCard: '.bookshelf-featured-card',
        booksFab: '.bookshelf-add-material-fab', report: '.learning-report-view',
      };
      const samples = []; const events = []; const ids = new WeakMap(); let nextId = 1;
      let active = true, frame = 0, last = 0, phase = 'initial-document', frames = 0, dirty = true;
      const now = () => performance.now();
      const id = node => { if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node); };
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const event = (type, details = {}) => { if (events.length < 10000) events.push({ t: now(), type, phase, ...details }); };
      const inputEvent = e => event(e.type, { targetId: e.target instanceof Element ? id(e.target) : null });
      document.addEventListener('pointerdown', inputEvent, true); document.addEventListener('click', inputEvent, true);
      const mo = new MutationObserver(records => {
        dirty = true;
        event('mutation', { count: records.length }); // No DOM text/attribute payloads or personal data.
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      const observers = [];
      for (const type of ['layout-shift', 'resource']) {
        try {
          const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (type === 'layout-shift') event(type, { value: entry.value, hadRecentInput: entry.hadRecentInput,
                sources: (entry.sources ?? []).map(source => ({ id: source.node ? id(source.node) : null,
                  previousRect: source.previousRect?.toJSON(), currentRect: source.currentRect?.toJSON() })) });
              else { dirty = true; const u = new URL(entry.name, location.href); event(type, { name: u.origin === location.origin ? u.pathname : '[external redacted]',
                initiator: entry.initiatorType, start: entry.startTime, end: entry.responseEnd }); }
            }
          });
          observer.observe({ type, buffered: true }); observers.push(observer);
        } catch { event('unsupported-observer', { observer: type }); }
      }
      const fontEvent = e => { dirty = true; event('fonts', { state: e.type }); };
      document.fonts.addEventListener('loading', fontEvent); document.fonts.addEventListener('loadingdone', fontEvent);
      document.fonts.ready.then(() => { dirty = true; event('fonts-ready-epoch'); });
      const tick = timestamp => {
        if (!active) return;
        const start = now(); const nodes = {};
        for (const [key, selector] of Object.entries(selectors)) {
          nodes[key] = [...document.querySelectorAll(selector)].slice(0, key === 'row' ? 5 : 3).map(node => {
            const r = rect(node); const hasBox = node.getClientRects().length > 0 && r.width > 0 && r.height > 0;
            const visible = hasBox && (typeof node.checkVisibility === 'function' ? node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) : null);
            return { id: id(node), hasBox, visible, ...r, scrollTop: node.scrollTop };
          });
        }
        const dashboard = [...document.querySelectorAll('.home-dashboard.home-dashboard-default')].find(n => n.getClientRects().length);
        const header = document.querySelector('.primary-app-header');
        const styles = {};
        if (dirty) {
          for (const [key, node] of [['dashboard', dashboard], ['header', header]]) if (node) {
            const computed = getComputedStyle(node);
            styles[key] = { display: computed.display, visibility: computed.visibility, font: computed.fontFamily,
              lineHeight: computed.lineHeight, inline: node.getAttribute('style'), chromeViewport: node.dataset.homeChromeViewport ?? null };
          }
          dirty = false;
        }
        if (frames++ < 15000) samples.push({ t: timestamp, phase, gap: last ? timestamp - last : null, nodes, styles,
          viewPresence: { home: Boolean(dashboard), books: Boolean(document.querySelector('.bookshelf-view')), report: Boolean(document.querySelector('.learning-report-view')) },
          fonts: document.fonts.status, scrollTop: document.scrollingElement?.scrollTop ?? null,
          viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth,
            visualHeight: visualViewport?.height ?? null, offsetTop: visualViewport?.offsetTop ?? null },
          cost: now() - start });
        last = timestamp; frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      window.__layoutDiagnostic = {
        arm(name) { phase = name; dirty = true; event('armed'); return { phase, t: now(), active }; },
        mark: event,
        warm() { window.requestIdleCallback = idle; window.cancelIdleCallback = cancelIdle; event('restore-native-idle'); },
        finish() { active = false; cancelAnimationFrame(frame); mo.disconnect(); observers.forEach(o => o.disconnect());
          document.removeEventListener('pointerdown', inputEvent, true); document.removeEventListener('click', inputEvent, true);
          document.fonts.removeEventListener('loading', fontEvent); document.fonts.removeEventListener('loadingdone', fontEvent);
          return { samples, events, limitReached: frames >= 15000, maximumFrames: 15000, maximumEvents: 10000, limitations: ['rAF sampling may miss composited frames', 'rect reads can perturb timing', 'system font only', 'cold leg disables idle preloading', 'no physical-device claim'] }; },
      };
    }, { mode, rows, today: E2E_TODAY });
    const nav = name => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true });
    async function settle(label) {
      await page.evaluate(name => window.__layoutDiagnostic.mark(name), `${label}:loaded`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(name => window.__layoutDiagnostic.mark(name), `${label}:second-rAF`);
      const fonts = await page.evaluate(() => Promise.race([document.fonts.ready.then(() => 'ready'), new Promise(resolve => setTimeout(() => resolve('pending'), 1500))]));
      await page.evaluate(data => window.__layoutDiagnostic.mark('font-checkpoint', data), { label, fonts });
      // Observation interval, not a readiness heuristic or production delay.
      await page.waitForTimeout(800);
      await page.evaluate(() => window.__layoutDiagnostic.mark('screenshot-start'));
      await testInfo.attach(`${label}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.evaluate(() => window.__layoutDiagnostic.mark('screenshot-end'));
    }
    async function visit(view, module, click, cold) {
      const armed = await page.evaluate(name => window.__layoutDiagnostic.arm(name), `${cold ? 'cold' : 'warm'}:${view}`);
      expect(armed.active).toBe(true); // Recorder acknowledged before input.
      await click();
      if (cold) {
        await expect(page.locator(`.route-skeleton--${view}`)).toBeVisible();
        await page.evaluate(() => window.__layoutDiagnostic.mark('fallback-visible'));
        await testInfo.attach(`${view}-fallback.png`, { body: await page.screenshot(), contentType: 'image/png' });
        await page.waitForTimeout(500);
        expect(gates.get(module).hits).toBeGreaterThan(0);
        gates.get(module).released = true;
        await page.evaluate(() => window.__layoutDiagnostic.mark('module-release'));
        gates.get(module).release();
      }
      await expect(page.locator(`.route-skeleton--${view}`)).toHaveCount(0);
      const loaded = { bookshelf: '.bookshelf-view', report: '.learning-report-view', month: '.schedule-month-view', week: '.schedule-week-view' };
      await expect(page.locator(loaded[view]).first()).toBeVisible();
      await settle(`${cold ? 'cold' : 'warm'}-${view}`);
    }
    async function home(label) {
      await page.evaluate(name => window.__layoutDiagnostic.arm(name), label);
      await nav('ホーム').click();
      await expect(page.locator('.home-today-panel')).toBeVisible();
      await settle(label);
    }
    let harnessCompleted = false;
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.home-today-panel')).toBeVisible();
      await expect(page.locator('.home-schedule-row').first()).toBeVisible();
      expect(await page.locator('html').getAttribute('data-font-preset')).toBeNull();
      await settle('initial-home');
      for (const cold of [true, false]) {
        if (!cold) await page.evaluate(() => window.__layoutDiagnostic.warm());
        await visit('bookshelf', 'BookshelfView', () => nav('教材').click(), cold);
        await expect(page.locator('.bookshelf-featured-card').first()).toBeVisible();
        await home(`${cold ? 'cold' : 'warm'}-books-return-home`);
        await visit('report', 'ReportView', () => page.locator('.home-progress-panel').getByRole('button', { name: '詳細を見る', exact: true }).click(), cold);
        await home(`${cold ? 'cold' : 'warm'}-report-return-home`);
        await visit('month', 'MonthView', async () => {
          await nav('予定').click();
          if (!cold) await page.getByRole('tablist', { name: '予定表示' }).getByRole('tab', { name: '月', exact: true }).click();
        }, cold);
        await visit('week', 'WeekView', () => page.getByRole('tablist', { name: '予定表示' }).getByRole('tab', { name: '週', exact: true }).click(), cold);
        await home(`${cold ? 'cold' : 'warm'}-week-return-home`);
      }
      expect(blockedExternal, 'Unexpected external access: diagnostic is incomplete, not a product pass').toEqual([]);
      harnessCompleted = true;
    } finally {
      for (const gate of gates.values()) gate.release();
      const evidence = await page.evaluate(() => window.__layoutDiagnostic?.finish()).catch(() => null);
      const incompletePhases = (evidence?.events ?? []).filter(event => event.type === 'font-checkpoint' && event.fonts !== 'ready').map(event => event.label);
      const incompleteReasons = [
        ...(!harnessCompleted ? ['harness-not-completed'] : []), ...(!evidence ? ['recorder-unavailable'] : []),
        ...(evidence?.limitReached ? ['frame-limit-reached'] : []), ...(evidence?.events.length >= 10000 ? ['event-limit-reached'] : []),
        ...(incompletePhases.length ? ['fonts-pending-at-checkpoint'] : []), ...(blockedExternal.length ? ['external-request-blocked'] : []),
      ];
      const visibilitySupported = !(evidence?.samples ?? []).some(sample => Object.values(sample.nodes).some(nodes => nodes.some(node => node.hasBox && node.visible === null)));
      const ranges = new Map();
      for (const sample of evidence?.samples ?? []) for (const key of ['header', 'dashboard', 'core', 'today', 'list', 'row', 'toolbar', 'nav']) {
        for (const node of sample.nodes[key] ?? []) {
          if (!node.hasBox || node.visible === false) continue;
          const rangeKey = `${sample.phase}|${key}|${node.id}`;
          const r = ranges.get(rangeKey) ?? { phase: sample.phase, anchor: key, nodeId: node.id, firstT: sample.t, lastT: sample.t, minHeight: node.height, maxHeight: node.height, minY: node.y, maxY: node.y, samples: 0 };
          r.lastT = sample.t; r.minHeight = Math.min(r.minHeight, node.height); r.maxHeight = Math.max(r.maxHeight, node.height);
          r.minY = Math.min(r.minY, node.y); r.maxY = Math.max(r.maxY, node.y); r.samples++; ranges.set(rangeKey, r);
        }
      }
      const summary = { captureStatus: incompleteReasons.length ? 'INCOMPLETE' : visibilitySupported ? 'CAPTURED_NOT_A_LAYOUT_PASS' : 'CAPTURED_VISIBILITY_UNCERTAIN', incompleteReasons, visibilitySupported,
        maxRecorderCostMs: Math.max(0, ...(evidence?.samples ?? []).map(s => s.cost)), maxFrameGapMs: Math.max(0, ...(evidence?.samples ?? []).map(s => s.gap ?? 0)),
        anchorRanges: [...ranges.values()], interpretation: 'Same node within phase only; mount/route changes and transient compression require frame inspection. CLS alone is insufficient.' };
      await testInfo.attach('frame-evidence.json', { body: Buffer.from(JSON.stringify({ observationOnly: true, harnessCompleted, incompletePhases, summary, variant: { width, rows, mode, motion }, evidence,
        gates: [...gates].map(([name, g]) => ({ name, hits: g.hits, released: g.released })), blockedExternal })), contentType: 'application/json' });
    }
  });
}
