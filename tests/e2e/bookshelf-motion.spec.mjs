import { expect, test } from './support/fixed-clock.mjs';

// Issue #696 S5: the bookshelf explains what the user did. Opening a material
// grows its detail cover out of the cover that was tapped, and going back
// grows the list cover out of the detail cover. Marking a favourite brings
// that card into "よく使う教材" without replaying the others. The first paint
// and filtering stay still.

async function seed(page, motion) {
  await page.addInitScript(({ motion }) => {
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
      material('shelf-a', 'アルゴリズム問題集', 80), material('shelf-b', 'ネットワーク演習', 30),
      material('shelf-c', 'データベース入門', 10), material('shelf-d', '統計の基礎', 0),
    ]));
    localStorage.setItem(`studyplanner:material-detail:v1:${user.id}:shelf-a`,
      JSON.stringify({ structureEnabled: false, structureVisible: false, favorite: true, structureItems: [] }));
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('bookshelf-motion-seeded', 'true');
  }, { motion });
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

for (const width of [320, 390, 1280]) {
  test(`a cover grows into its detail and back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page);
    await openBookshelf(page);
    expect(await motionLog(page)).toEqual([]);

    await openWithKeyboard(page);
    await expect(page.getByRole('heading', { name: '教材の詳細' })).toBeVisible();
    expect(await motionLog(page)).toEqual([{ key: 'cover:shelf-b:detail', properties: ['scale', 'translate'] }]);

    await page.getByRole('button', { name: '教材一覧へ戻る' }).click();
    await expect(openInCategory(page)).toBeVisible();
    // It returns to a copy that is on screen. A copy inside a clipping list
    // arrives in place rather than having its travel cut off.
    const back = await motionLog(page);
    if (back.length === 0) {
      // Nothing to return to on screen (the list starts at its top again on a
      // short screen): no cover may move.
      for (const cover of await page.locator('[data-cover-of="shelf-b"]').all()) await expect(cover).not.toBeInViewport({ ratio: 0.5 });
      return;
    }
    expect(back).toHaveLength(1);
    expect(back[0].key).toMatch(/^cover:shelf-b:(featured|category|recent)$/);
    expect([['scale', 'translate'], ['opacity', 'scale', 'translate']]).toContainEqual(back[0].properties);
    const target = page.locator(`.bookshelf-${{ featured: 'featured-grid', category: 'subject-list', recent: 'recent-list' }[back[0].key.split(':')[2]]} [data-cover-of="shelf-b"]`);
    await expect(target).toBeInViewport({ ratio: 0.5 });
    await expect.poll(() => page.locator('[data-cover-of="shelf-b"]').first().evaluate(element => element.getAnimations().length)).toBe(0);
  });
}

test('marking a favourite brings that card in without replaying the others', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
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
    expect(log.map(entry => entry.properties)).toEqual(level === 'off' ? [] : [['opacity']]);
  });
}

test('going back never picks a copy scrolled out of sight in the featured row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openBookshelf(page);
  // The third featured card sits beyond the row's visible width.
  const hidden = page.locator('.bookshelf-featured-grid [data-cover-of="shelf-c"]');
  await expect(hidden).toHaveCount(1);
  await page.locator('.bookshelf-subject-list').getByRole('button', { name: 'データベース入門を開く' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '教材の詳細' })).toBeVisible();
  await motionLog(page);
  await page.getByRole('button', { name: '教材一覧へ戻る' }).click();
  const back = await motionLog(page);
  expect(back).toHaveLength(1);
  const section = back[0].key.split(':')[2];
  await expect(page.locator(`.bookshelf-${{ featured: 'featured-grid', category: 'subject-list', recent: 'recent-list' }[section]} [data-cover-of="shelf-c"]`))
    .toBeInViewport({ ratio: 0.5 });
});

test('a cover never takes a tap while it moves', async ({ page }) => {
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
