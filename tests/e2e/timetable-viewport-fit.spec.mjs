import { expect, test } from './support/fixed-clock.mjs';

// These are browser content viewports, not device screenshot heights. Short
// viewports and enlarged text preserve readable rows through internal scroll.
const cases = [
  { width: 320, height: 568, longTitle: true },
  { width: 390, height: 704, multi: true },
  ...[320, 360, 375, 390, 430].map(width => ({ width, height: 704, unset: true })),
  { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 375, height: 667 },
  { width: 390, height: 704, fit: true }, { width: 430, height: 760, fit: true },
  { width: 1280, height: 720, fit: true }, { width: 1280, height: 900, fit: true },
  { width: 390, height: 480 }, { width: 1280, height: 500 },
  { width: 390, height: 704, largeText: true },
  { width: 390, height: 704, count: 5, fit: true },
  { width: 390, height: 704, count: 8 },
];
for (const { width, height, fit = false, largeText = false, count = 6, unset = false, longTitle = false, multi = false } of cases) {
  test(`timetable ${count} rows ${width}x${height}${largeText ? ' 200% text' : ''}${unset ? ' period unset' : ''}${longTitle ? ' long title' : ''}${multi ? ' A/B stacked' : ''}: ${fit ? 'fits' : 'reachable without clipping'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ count, largeText, unset, longTitle, multi }) => {
      window.requestIdleCallback = () => 1;
      window.cancelIdleCallback = () => {};
      const now = '2026-10-29T00:00:00Z';
      const user = { id: 'timetable-fit-owner', email: 'fit@example.test', username: 'Fit', avatar: '', createdAt: now };
      const termId = `timetable-term:${btoa(user.id).replace(/=+$/, '')}:2026-full-year`;
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      localStorage.setItem('study-planner-appearance', 'pixel');
      localStorage.setItem('study-planner-motion', 'standard');
      for (const key of ['plans', 'actuals', 'todos.v1', 'studyMaterials.v1', 'studySubjects.v1']) localStorage.setItem(`studyplanner.${key}`, '[]');
      localStorage.setItem('studyplanner.timetableTerms.v1', JSON.stringify([{ id: termId, userId: user.id, year: 2026, kind: 'fullYear', label: unset ? '2026年 前期' : '2026年 通年', ...(unset ? {} : { startDate: '2026-04-01', endDate: '2027-03-31' }), isActive: true, usesAlternatingWeeks: multi, alternatingWeekAnchorDate: '2026-08-17', createdAt: now, updatedAt: now }]));
      const times = [['08:40', '10:10'], ['10:20', '11:50'], ['12:45', '14:15'], ['14:25', '15:55'], ['16:05', '17:35'], ['18:00', '19:30'], ['19:40', '20:30'], ['20:40', '21:30']];
      localStorage.setItem('studyplanner.timetablePeriods.v1', JSON.stringify(times.slice(0, count).map(([startTime, endTime], i) => ({ id: `fit-period-${i}`, userId: user.id, termId, periodNumber: i + 1, label: `${i + 1}`, startTime, endTime, createdAt: now, updatedAt: now }))));
      localStorage.setItem('studyplanner.scheduleTemplates.v1', JSON.stringify(times.slice(0, count).map(([startTime, endTime], i) => ({ id: `fit-class-${i}`, userId: user.id, termId, periodNumber: i + 1, title: longTitle ? `応用数学と統計学の長い授業名${i + 1}` : `数学${i + 1}`, subject: '数学', type: 'school-event', weekday: 'mon', startTime, endTime, classroom: '101', memo: '', active: true, createdAt: now, updatedAt: now }))));
      if (multi) {
        const classes = JSON.parse(localStorage.getItem('studyplanner.scheduleTemplates.v1'));
        for (const week of ['a', 'b']) classes.push({ ...classes[0], id: `fit-${week}`, title: `交互週${week.toUpperCase()}の長い授業名`, alternatingWeek: week });
        localStorage.setItem('studyplanner.scheduleTemplates.v1', JSON.stringify(classes));
      }
      const frames = []; let active = true, frame;
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      const tick = () => {
        if (!active) return;
        if (largeText && document.documentElement) document.documentElement.style.setProperty('font-size', '200%', 'important');
        const root = document.querySelector('.timetable-view');
        if (root) frames.push({ t: performance.now(), skeleton: Boolean(root.closest('.route-skeleton')), root: rect(root), headerBottom: document.querySelector('.timetable-primary-header')?.getBoundingClientRect().bottom ?? null, visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, offsetTop: visualViewport.offsetTop, offsetLeft: visualViewport.offsetLeft, scale: visualViewport.scale } : null, rows: [...root.querySelectorAll('.timetable-period-cell')].map(rect) });
        if (frames.length < 2000) frame = requestAnimationFrame(tick);
      };
      window.__timeFitFrames = { frames, stop() { active = false; cancelAnimationFrame(frame); } };
      frame = requestAnimationFrame(tick);
    }, { count, largeText, unset, longTitle, multi });
    let release;
    const delivery = new Promise(resolve => { release = resolve; });
    await page.route('**/TimetableView-*.js', async route => { await delivery; await route.continue(); });
    try {
      await page.goto('/');
      await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '時間割', exact: true }).click();
      await expect(page.locator('.route-skeleton--timetable')).toBeVisible();
      await expect(page.locator('.route-skeleton--timetable .timetable-period-cell')).toHaveCount(count);
      await expect.poll(() => page.evaluate(() => window.__timeFitFrames.frames.filter(f => f.skeleton).length)).toBeGreaterThanOrEqual(2);
      release();
      await expect(page.locator('.route-skeleton--timetable')).toHaveCount(0);
      const rows = page.locator('.timetable-view .timetable-period-cell');
      await expect(page.getByLabel(`${count}限 開始時刻`, { exact: true })).toBeVisible();
      await expect(rows).toHaveCount(count);
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => page.evaluate(() => window.__timeFitFrames.frames.filter(f => !f.skeleton).length)).toBeGreaterThanOrEqual(8);
      const entry = await page.evaluate(() => window.__timeFitFrames.frames);
      const skeleton = entry.filter(f => f.skeleton).at(-1), loaded = entry.find(f => !f.skeleton);
      expect(skeleton.rows).toHaveLength(count); expect(loaded.rows).toHaveLength(count);
      for (let i = 0; i < count; i++) for (const key of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(skeleton.rows[i][key] - loaded.rows[i][key]), `skeleton row ${i + 1} ${key}`).toBeLessThanOrEqual(2);
      }
      const metrics = await page.evaluate(() => {
        const grid = document.querySelector('.timetable-grid-shell'), nav = document.querySelector('.primary-bottom-nav');
        const r = grid.getBoundingClientRect();
        const term = document.querySelector('.timetable-period-trigger > span').getBoundingClientRect();
        const date = document.querySelector('.timetable-period-trigger > small').getBoundingClientRect();
        const termLayout = { term: { left: term.left, right: term.right, top: term.top, bottom: term.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, sameRow: Math.min(term.bottom, date.bottom) > Math.max(term.top, date.top) && date.left >= term.right - 1 };
        return { termLayout, scrollHeight: grid.scrollHeight, clientHeight: grid.clientHeight, bottom: r.bottom, navTop: nav.getBoundingClientRect().top, overflow: getComputedStyle(grid).overflowY, viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, font: getComputedStyle(grid).fontFamily };
      });
      expect(metrics.documentWidth).toBeLessThanOrEqual(width + 1);
      await expect(page.locator('.timetable-period-trigger > small')).toHaveText(unset ? '期間未設定' : '4/1〜翌3/31');
      const actions = await page.locator('.timetable-grid-actions > button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
      for (let i = 1; i < actions.length; i++) expect(actions[i].left >= actions[i - 1].right || actions[i].top >= actions[i - 1].bottom).toBe(true);
      // Normal mobile widths keep the date beside the term; enlarged text may wrap.
      if (!largeText) expect(metrics.termLayout.sameRow).toBe(true);
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.navTop + 1);
      expect(['auto', 'scroll']).toContain(metrics.overflow);
      if (fit) expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
      if (longTitle || multi) {
        const classCell = page.locator('.timetable-grid-cell.has-class').first();
        if (multi) await expect(classCell.locator('.timetable-class-card')).toHaveCount(2);
        const cards = await classCell.locator('.timetable-class-card').evaluateAll(nodes => nodes.map(node => {
          const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
          const title = node.querySelector('strong'), meta = node.querySelector('.timetable-class-meta'), badge = node.querySelector('.timetable-pattern-badge');
          return { card: rect(node), title: rect(title), lineHeight: parseFloat(getComputedStyle(title).lineHeight), meta: rect(meta), badge: badge ? rect(badge) : null };
        }));
        await testInfo.attach('timetable-readable-cards.json', { body: Buffer.from(JSON.stringify(cards)), contentType: 'application/json' });
        for (const item of cards) {
          expect(item.title.height).toBeGreaterThanOrEqual(item.lineHeight - 1);
          expect(item.title.top).toBeGreaterThanOrEqual(item.card.top - 1);
          expect(item.title.bottom).toBeLessThanOrEqual(item.meta.top + 1);
          expect(item.meta.bottom).toBeLessThanOrEqual((item.badge?.top ?? item.card.bottom) + 1);
          if (item.badge) expect(item.badge.bottom).toBeLessThanOrEqual(item.card.bottom + 1);
        }
        await classCell.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog').getByText(longTitle ? '応用数学と統計学の長い授業名1' : '数学1', { exact: true }).first()).toBeVisible();
        await page.keyboard.press('Escape');
      }
      const lastInput = page.getByLabel(`${count}限 終了時刻`, { exact: true });
      await lastInput.focus();
      await lastInput.scrollIntoViewIfNeeded();
      const reach = await lastInput.evaluate(node => {
        const r = node.getBoundingClientRect(), shell = node.closest('.timetable-grid-shell').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, shellTop: shell.top, shellBottom: shell.bottom, navTop: document.querySelector('.primary-bottom-nav').getBoundingClientRect().top, focused: document.activeElement === node, hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      });
      expect(reach.focused).toBe(true); expect(reach.hit).toBe(true);
      expect(reach.height).toBeGreaterThanOrEqual(28);
      expect(reach.top).toBeGreaterThanOrEqual(reach.shellTop - 1);
      expect(reach.bottom).toBeLessThanOrEqual(Math.min(reach.shellBottom, reach.navTop) + 1);
      await testInfo.attach('timetable-fit-metrics.json', { body: Buffer.from(JSON.stringify({ metrics, reach })), contentType: 'application/json' });
    } finally {
      release();
      const frames = await page.evaluate(() => { window.__timeFitFrames.stop(); return window.__timeFitFrames.frames; });
      await testInfo.attach('timetable-entry-frames.json', { body: Buffer.from(JSON.stringify(frames)), contentType: 'application/json' });
    }
  });
}
