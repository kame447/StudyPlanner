import { expect, test } from './support/fixed-clock.mjs';

// Issue #696 S3: edits to the proposed plan are explained in place. Opening
// the preview, paging and switching overview/day stay still; moving a block
// lands it at its new time, undo lands it back, and excluding a block updates
// only that day's count. Nothing claims progress the plan did not make.

async function seed(page, motion) {
  await page.addInitScript(({ motion }) => {
    if (localStorage.getItem('preview-motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'preview-motion-user', email: 'preview-motion@example.com', username: 'preview-motion', avatar: '', createdAt: now };
    const iso = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const monday = new Date(today); monday.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()));
    const weekStartDate = iso(monday);
    const draft = (id, title, startTime, endTime) => ({ id, userId: user.id, date: iso(tomorrow), startTime, endTime, title,
      subject: 'TOEIC', type: 'study', label: '金フレ', source: 'ai', status: 'draft', userEdited: false, createdAt: now, updatedAt: now });
    const drafts = [draft('motion-a', '金フレ A', '09:00', '10:00'), draft('motion-b', '金フレ B', '13:00', '14:00')];
    const planningState = { weekStartDate, revision: 1, conversationRequestSequence: 0, mode: 'awaiting_approval',
      draftBlocks: drafts, previewCandidates: [], messages: [], updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem(`studyplanner.weeklyPlanning.${user.id}.${weekStartDate}`,
      JSON.stringify({ version: 3, ownerId: user.id, payload: { version: 2, state: planningState } }));
    localStorage.setItem(`studyplanner.weeklyPlanning.activeSession.${user.id}`,
      JSON.stringify({ version: 1, ownerId: user.id, weekStartDate, conversationId: null }));
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('preview-motion-seeded', 'true');
  }, { motion });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__motionLog = [];
    Element.prototype.animate = function animate(frames, options) {
      const key = this.dataset?.motionKey;
      if (key) window.__motionLog.push({ key, properties: Object.keys((Array.isArray(frames) ? frames[0] : {}) ?? {}).filter(name => name !== 'offset').sort() });
      return original.call(this, frames, options);
    };
  });
}

const motionLog = page => page.evaluate(() => window.__motionLog.splice(0));

async function openPreview(page) {
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全2件');
  return preview;
}

const dayBlock = (preview, title) => preview.locator('.ai-planning-preview-day-column-detail .ai-planning-draft-block').filter({ hasText: title });

async function dragDown(page, block, pixels) {
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 12);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + pixels / 2, { steps: 6 });
  await page.mouse.move(x, y + pixels, { steps: 6 });
  await page.mouse.up();
}

for (const width of [320, 390, 1280]) {
  test(`opening and switching the preview stay still; a moved block lands and undo lands it back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page);
    const preview = await openPreview(page);
    await preview.getByRole('tab', { name: '日別' }).click();
    await preview.getByRole('tab', { name: '全体' }).click();
    await preview.getByRole('tab', { name: '日別' }).click();
    await expect(dayBlock(preview, '金フレ B')).toBeVisible();
    expect(await motionLog(page)).toEqual([]);

    await dragDown(page, dayBlock(preview, '金フレ B'), 76);
    await expect(dayBlock(preview, '金フレ B')).not.toContainText('13:00-14:00');
    const moved = await motionLog(page);
    // Only the moved block reacts, and it settles in place (no fade, no slide).
    expect(moved).toEqual([{ key: 'block:motion-b', properties: ['scale'] }]);

    await page.getByRole('button', { name: /元に戻す/ }).click();
    await expect(dayBlock(preview, '金フレ B')).toContainText('13:00-14:00');
    expect(await motionLog(page)).toEqual([{ key: 'block:motion-b', properties: ['scale'] }]);
  });
}

test('excluding a block updates only that day count; the other block does not replay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const preview = await openPreview(page);
  await preview.getByRole('tab', { name: '日別' }).click();
  const block = dayBlock(preview, '金フレ A');
  const box = await block.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await motionLog(page);
  await page.getByRole('button', { name: '金フレ Aを計画から除外' }).click();
  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全1件');
  const log = await motionLog(page);
  expect(log.filter(entry => entry.key.startsWith('block:'))).toEqual([]);
  expect(log.map(entry => entry.key).every(key => key.startsWith('count:'))).toBe(true);
});

test('at off nothing in the preview animates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, 'off');
  const preview = await openPreview(page);
  await preview.getByRole('tab', { name: '日別' }).click();
  await dragDown(page, dayBlock(preview, '金フレ B'), 76);
  await expect(dayBlock(preview, '金フレ B')).not.toContainText('13:00-14:00');
  expect(await motionLog(page)).toEqual([]);
});
