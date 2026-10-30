import { expect, test } from './support/fixed-clock.mjs';

// Navigation displays each cover immediately in its destination frame.
// Data-change feedback (for example adding a favourite) remains separate.

async function seed(page, motion, imageUrl) {
  await page.addInitScript(({ motion, imageUrl }) => {
    if (localStorage.getItem('bookshelf-motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'shelf-motion-user', email: 'shelf@example.test', username: 'shelf', avatar: '', createdAt: now };
    const subject = { id: 'shelf-subject', userId: user.id, name: '情報科学', color: '#2f6fc2', createdAt: now, updatedAt: now };
    const material = (id, name, currentUnit) => ({ id, userId: user.id, name, subjectId: subject.id, subjectName: subject.name,
      color: subject.color, status: 'active', paceEnabled: true, progressUnit: 'page', totalUnits: 200, currentUnit, createdAt: now, updatedAt: now });
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([
      material('shelf-a', 'アルゴリズム問題集', 80), { ...material('shelf-b', 'ネットワーク演習', 30), ...(imageUrl ? { coverImageUrl: imageUrl } : { coverImageDataUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%22120%22%3E%3Crect width=%2280%22 height=%22120%22 fill=%22%232f6fc2%22/%3E%3C/svg%3E' }) },
      material('shelf-c', 'データベース入門', 10), material('shelf-d', '統計の基礎', 0),
    ]));
    localStorage.setItem(`studyplanner:material-detail:v1:${user.id}:shelf-a`,
      JSON.stringify({ structureEnabled: false, structureVisible: false, favorite: true, structureItems: [] }));
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('bookshelf-motion-seeded', 'true');
  }, { motion, imageUrl });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__motionLog = [];
    Element.prototype.animate = function animate(frames, options) {
      const section = this.closest('.bookshelf-detail-page') ? 'detail' : this.closest('.bookshelf-featured-grid') ? 'featured'
        : this.closest('.bookshelf-subject-list') ? 'category' : 'recent';
      const key = this.dataset?.motionKey ?? (this.dataset?.coverOf ? `cover:${this.dataset.coverOf}:${section}` : undefined);
      if (key) window.__motionLog.push({ key, properties: Object.keys((Array.isArray(frames) ? frames[0] : {}) ?? {}).filter(name => name !== 'offset').sort() });
      return original.call(this, frames, options);
    };
  });
}

const openInCategory = page => page.locator('.bookshelf-subject-list').getByRole('button', { name: 'ネットワーク演習を開く' });
// The row's open button spans the row under its menu button; open it as a
// keyboard user would.
async function openWithKeyboard(page) {
  await openInCategory(page).focus();
  await page.keyboard.press('Enter');
}
const motionLog = page => page.evaluate(() => window.__motionLog.splice(0));

async function openBookshelf(page) {
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: '教材' }).click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
  await expect(openInCategory(page)).toBeVisible();
}

async function recordCovers(page) {
  await page.addInitScript(() => {
    const frames = [], detailLayouts = [], ids = new WeakMap(); let nextId = 1, phase = 'entry', active = true, frame;
    const tick = () => {
      if (!active) return;
      const root = document.querySelector('main > .bookshelf-view');
      if (root) {
        const origin = root.getBoundingClientRect();
        const action = root.querySelector('.bookshelf-detail-primary-action > button');
        if (action?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          if (!ids.has(action)) ids.set(action, nextId++);
          const content = root.querySelector('.bookshelf-detail-content'), nav = document.querySelector('.primary-bottom-nav');
          const r = action.getBoundingClientRect(), c = content.getBoundingClientRect(), last = content.lastElementChild;
          const actionStyle = getComputedStyle(action.parentElement), contentStyle = getComputedStyle(content);
          const blockers = [], scroll = [];
          for (let ancestor = action.parentElement; ancestor; ancestor = ancestor.parentElement) {
            scroll.push({ tag: ancestor.tagName, className: ancestor.className, top: ancestor.scrollTop });
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) {
              const b = ancestor.getBoundingClientRect();
              if (r.top < b.top + ancestor.clientTop - 1 || r.bottom > b.top + ancestor.clientTop + ancestor.clientHeight + 1) blockers.push(ancestor.className);
            }
          }
          detailLayouts.push({ t: performance.now(), phase, id: ids.get(action), actionTop: r.top, actionBottom: r.bottom,
            navTop: nav.getBoundingClientRect().top, viewportHeight: innerHeight, scroll, blockers,
            contentToActionGap: r.top - c.bottom,
            designedActionGap: parseFloat(actionStyle.paddingTop) + parseFloat(actionStyle.marginTop) + parseFloat(contentStyle.marginBottom),
            unusedContentSpace: last ? c.bottom - last.getBoundingClientRect().bottom : 0,
            designedContentSpace: parseFloat(contentStyle.paddingBottom) + (last ? parseFloat(getComputedStyle(last).marginBottom) : 0) });
        }
        for (const node of root.querySelectorAll('[data-cover-of], .bookshelf-expanded-materials')) {
          if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
          if (!ids.has(node)) ids.set(node, nextId++);
          const s = getComputedStyle(node), r = node.getBoundingClientRect();
          const card = node.closest('[data-material-entry], .bookshelf-detail-hero');
          const c = card?.getBoundingClientRect();
          frames.push({ t: performance.now(), phase, id: ids.get(node), key: node.dataset.coverOf ?? 'category',
            section: node.closest('.bookshelf-detail-page') ? 'detail' : 'list', categoryContent: Boolean(node.closest('.bookshelf-expanded-materials')),
            x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height,
            transform: s.transform, translate: s.translate, scale: s.scale, rotate: s.rotate,
            decoded: node instanceof HTMLImageElement ? node.complete && node.naturalWidth > 0 : null,
            card: c ? { x: c.x - origin.x, y: c.y - origin.y, width: c.width, height: c.height } : null });
        }
      }
      if (frames.length < 6000) frame = requestAnimationFrame(tick);
    };
    window.__coverFrames = { frames, detailLayouts, arm(value) { phase = value; }, stop() { active = false; cancelAnimationFrame(frame); } };
    frame = requestAnimationFrame(tick);
  });
}

async function expectStationaryCovers(page, phase, section) {
  await expect.poll(() => page.evaluate(({ phase, section }) => {
    const frames = window.__coverFrames.frames.filter(f => f.phase === phase && f.section === section);
    const targets = frames.filter(f => phase === 'category-open' ? f.categoryContent : f.key !== 'category');
    return targets.length > 0 && [...new Set(targets.map(f => f.id))].every(id => {
      const same = targets.filter(f => f.id === id);
      return same.length >= 8 && same.at(-1).t - same[0].t >= 120;
    });
  }, { phase, section })).toBe(true);
  const frames = await page.evaluate(({ phase, section }) => window.__coverFrames.frames.filter(f => f.phase === phase && f.section === section && (phase !== 'category-open' || f.categoryContent)), { phase, section });
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    expect(frame.transform).toBe('none');
    expect(['none', '0px', '0px 0px']).toContain(frame.translate);
    expect(['none', '1', '1 1']).toContain(frame.scale);
    expect(['none', '0deg']).toContain(frame.rotate);
  }
  for (const id of new Set(frames.map(f => f.id))) {
    const same = frames.filter(f => f.id === id);
    // Compare only the same destination node. A list and its detail page
    // intentionally have different cover positions and sizes.
    for (const key of ['x', 'y', 'width', 'height']) expect(Math.max(...same.map(f => f[key])) - Math.min(...same.map(f => f[key]))).toBeLessThanOrEqual(1);
    const cards = same.map(f => f.card).filter(Boolean);
    for (const key of ['x', 'y', 'width', 'height']) if (cards.length) expect(Math.max(...cards.map(c => c[key])) - Math.min(...cards.map(c => c[key]))).toBeLessThanOrEqual(1);
  }
}

for (const width of [320, 375, 390, 1280]) {
  test(`photo and placeholder stay in their destination frames at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : width === 375 ? 667 : 844 });
    let releaseImage;
    const imageDelivery = new Promise(resolve => { releaseImage = resolve; });
    if (width === 390) await page.route('**/synthetic-entry-cover.svg', async route => {
      await imageDelivery;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#2f6fc2"/></svg>' });
    });
    await seed(page, undefined, width === 390 ? '/synthetic-entry-cover.svg' : undefined);
    await recordCovers(page);
    try {
      await openBookshelf(page);
      await expectStationaryCovers(page, 'entry', 'list');
      releaseImage();
      await expect.poll(() => page.locator('img[data-cover-of="shelf-b"]').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect.poll(() => page.evaluate(() => window.__coverFrames.frames.filter(f => f.phase === 'entry' && f.key === 'shelf-b' && f.decoded).length)).toBeGreaterThanOrEqual(8);
      await expectStationaryCovers(page, 'entry', 'list');
      expect(await motionLog(page)).toEqual([]);
      for (const [id, name] of [['shelf-b', 'ネットワーク演習'], ['shelf-c', 'データベース入門']]) {
        await page.evaluate(value => window.__coverFrames.arm(value), `detail-${id}`);
        const button = page.locator('.bookshelf-subject-list').getByRole('button', { name: `${name}を開く` });
        await button.focus(); await page.keyboard.press('Enter');
        await expect(page.locator('.bookshelf-detail-page')).toHaveAttribute('aria-label', `${name}の詳細`);
        await expectStationaryCovers(page, `detail-${id}`, 'detail');
        expect((await motionLog(page)).filter(entry => entry.key.startsWith('cover:'))).toEqual([]);
        const action = page.getByRole('button', { name: 'この教材を予定に追加', exact: true });
        // Capture initial layout before focus/trial click can scroll the CTA into view.
        if (width === 375 || width === 390) {
          await expect.poll(() => page.evaluate(phase => {
            const frames = window.__coverFrames.detailLayouts.filter(f => f.phase === phase);
            return frames.length > 0 && [...new Set(frames.map(f => f.id))].every(id => {
              const same = frames.filter(f => f.id === id);
              return new Set(same.map(f => f.t)).size >= 8 && same.at(-1).t - same[0].t >= 120;
            });
          }, `detail-${id}`)).toBe(true);
          const initial = await page.evaluate(phase => window.__coverFrames.detailLayouts.filter(f => f.phase === phase), `detail-${id}`);
          await testInfo.attach(`short-detail-initial-layout-${id}-${width}.json`, { body: Buffer.from(JSON.stringify(initial)), contentType: 'application/json' });
          for (const frame of initial) {
            expect(frame.actionTop).toBeGreaterThanOrEqual(-1);
            expect(frame.actionBottom).toBeLessThanOrEqual(Math.min(frame.navTop, frame.viewportHeight) + 1);
            expect(frame.blockers).toEqual([]);
            expect(frame.contentToActionGap).toBeLessThanOrEqual(frame.designedActionGap + 1);
            expect(frame.unusedContentSpace).toBeLessThanOrEqual(frame.designedContentSpace + 1);
          }
        }
        await action.focus(); await action.click({ trial: true });
        const layout = await action.evaluate(node => {
          const detail = node.closest('.bookshelf-detail-page'), content = detail.querySelector('.bookshelf-detail-content');
          const r = node.getBoundingClientRect(), c = content.getBoundingClientRect(), last = content.lastElementChild?.getBoundingClientRect();
          const nav = document.querySelector('.primary-bottom-nav').getBoundingClientRect();
          const blockers = [];
          for (let p = node.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowY)) {
              const b = p.getBoundingClientRect();
              if (r.top < b.top + p.clientTop - 1 || r.bottom > b.top + p.clientTop + p.clientHeight + 1) blockers.push(p.className);
            }
          }
          return { contentHeight: c.height, minHeight: getComputedStyle(content).minHeight, contentToActionGap: r.top - c.bottom,
            lastContentToActionGap: last ? r.top - last.bottom : null, actionTop: r.top, actionBottom: r.bottom,
            navTop: nav.top, viewportHeight: innerHeight, blockers, focused: document.activeElement === node };
        });
        await testInfo.attach(`short-detail-layout-${id}-${width}.json`, { body: Buffer.from(JSON.stringify(layout)), contentType: 'application/json' });
        expect(layout.minHeight).toBe('0px'); expect(layout.focused).toBe(true); expect(layout.blockers).toEqual([]);
        expect(layout.actionTop).toBeGreaterThanOrEqual(-1);
        expect(layout.actionBottom).toBeLessThanOrEqual(Math.min(layout.navTop, layout.viewportHeight) + 1);
        await page.evaluate(value => window.__coverFrames.arm(value), `back-${id}`);
        await page.getByRole('button', { name: '教材一覧へ戻る' }).click();
        await expect(openInCategory(page)).toBeVisible();
        await expectStationaryCovers(page, `back-${id}`, 'list');
        expect((await motionLog(page)).filter(entry => entry.key.startsWith('cover:'))).toEqual([]);
      }
      const category = page.locator('.bookshelf-subject-toggle').filter({ hasText: '情報科学' });
      await page.evaluate(() => window.__coverFrames.arm('category-close'));
      await category.click(); await expect(category).toHaveAttribute('aria-expanded', 'false');
      await page.evaluate(() => window.__coverFrames.arm('category-open'));
      await category.click(); await expect(category).toHaveAttribute('aria-expanded', 'true');
      await expectStationaryCovers(page, 'category-open', 'list');
      await expect(page.locator('.bookshelf-expanded-materials')).not.toHaveClass(/motion-reveal/);
    } finally {
      releaseImage();
      const { frames, detailLayouts } = await page.evaluate(() => { window.__coverFrames.stop(); return { frames: window.__coverFrames.frames, detailLayouts: window.__coverFrames.detailLayouts }; });
      await testInfo.attach('bookshelf-detail-layout-frames.json', { body: Buffer.from(JSON.stringify(detailLayouts)), contentType: 'application/json' });
      expect(frames.length).toBeLessThan(6000);
      await testInfo.attach('bookshelf-destination-frames.json', { body: Buffer.from(JSON.stringify(frames)), contentType: 'application/json' });
    }
  });
}

test('marking a favourite brings that card in without replaying the others', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, 'standard');
  await openBookshelf(page);
  // よく使う教材 shows three: the favourite first, then the others.
  const featured = page.locator('.bookshelf-featured-card');
  await expect(featured).toHaveCount(3);
  await expect(featured.filter({ hasText: '統計の基礎' })).toHaveCount(0);
  await page.locator('.bookshelf-subject-list').getByRole('button', { name: '統計の基礎のメニュー' }).click();
  await page.getByText('よく使う教材に追加').click();
  await expect(featured.filter({ hasText: '統計の基礎' })).toHaveCount(1);
  const log = await motionLog(page);
  expect(log.find(entry => entry.key === 'featured:shelf-d')?.properties).toEqual(['opacity', 'scale', 'translate']);
  expect(log.filter(entry => entry.key === 'featured:shelf-a' && entry.properties.includes('opacity'))).toEqual([]);
});

test('filtering only shows results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openBookshelf(page);
  await page.getByRole('button', { name: '学習中', exact: true }).click();
  await page.getByRole('button', { name: 'すべての状態', exact: true }).click();
  expect(await motionLog(page)).toEqual([]);
});

for (const level of ['reduced', 'off']) {
  test(`at ${level} the detail cover does not travel`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, level);
    await openBookshelf(page);
    await openWithKeyboard(page);
    await expect(page.getByRole('heading', { name: '教材の詳細' })).toBeVisible();
    const log = await motionLog(page);
    expect(log.filter(entry => entry.properties.includes('translate') || entry.properties.includes('scale'))).toEqual([]);
    expect(log.filter(entry => entry.key.startsWith('cover:'))).toEqual([]);
  });
}

test('a cover does not intercept the material open action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openBookshelf(page);
  const pointerEvents = await page.locator('[data-cover-of]').evaluateAll(covers => [...new Set(covers.map(cover => getComputedStyle(cover).pointerEvents))]);
  expect(pointerEvents).toEqual(['none']);
  // A tap on a cover still opens its own material through the row.
  const cover = page.locator('.bookshelf-subject-list [data-cover-of="shelf-b"]');
  const box = await cover.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.bookshelf-detail-page')).toHaveAttribute('aria-label', 'ネットワーク演習の詳細');
});
