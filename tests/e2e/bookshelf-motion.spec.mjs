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
      const key = this.dataset?.motionKey ?? (this.dataset?.coverOf ? `cover:${this.dataset.coverOf}:${this.closest('.bookshelf-detail-page') ? 'detail' : 'list'}` : undefined);
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
    const back = await motionLog(page);
    expect(back).toEqual([{ key: 'cover:shelf-b:list', properties: ['scale', 'translate'] }]);
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
