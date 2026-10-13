import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

async function browseAnotherDateThenHome(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'ホーム' }).click();
}


async function expectOriginalRowHeight(row) {
  const heights = await row.evaluate(element => {
    // Recreate the previous one-button row under the same inherited layout values.
    const original = document.createElement('button');
    original.type = 'button';
    original.tabIndex = -1;
    original.setAttribute('aria-hidden', 'true');
    original.className = element.classList.contains('home-schedule-empty') ? 'home-schedule-empty' : 'home-schedule-add-row';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '20'); icon.setAttribute('height', '20');
    original.append(icon);
    element.after(original);
    const result = { original: original.getBoundingClientRect().height, current: element.getBoundingClientRect().height };
    original.remove();
    return result;
  });
  expect(heights.current).toBeCloseTo(heights.original, 1);
}

for (const width of [390, 1280]) {
  test(`Home adds an event or study without Calendar navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      if (localStorage.getItem('home-create-seeded')) return;
      const now = new Date().toISOString();
      const user = { id: 'home-create-user', email: 'home-create@example.com', username: 'Home検証', avatar: '', createdAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
      localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{ id: 'home-todo', userId: user.id, title: '検証課題', subject: '', type: 'study', estimatedMinutes: 30, dueDate: '2026-08-20', memo: '', status: 'open', scheduledPlanId: null, createdAt: now, updatedAt: now }]));
      localStorage.setItem('home-create-seeded', '1');
    });
    await page.goto('/');
    const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
    const home = page.locator('.home-main');
    await expect(home).toBeVisible();
    await expect(home).not.toContainText('今日の予定はまだありません');
    await browseAnotherDateThenHome(page);
    const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
    await expectOriginalRowHeight(row);
    const closedBox = await row.boundingBox();
    await add.click();
    const chooser = row;
    const close = chooser.getByRole('button', { name: '予定の追加を閉じる', exact: true });
    await expect(chooser.getByRole('button')).toHaveCount(3);
    await expect(chooser.locator('.lucide-calendar-plus')).toHaveCount(1);
    await expect(chooser.locator('.lucide-book-open-check')).toHaveCount(1);
    await expect(close.locator('.lucide-x')).toHaveCount(1);
    await expect(chooser.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.home-add-sheet, .home-add-overlay')).toHaveCount(0);
    const chooserBox = await chooser.boundingBox();
    expect(chooserBox).toEqual(closedBox);
    const boxes = await chooser.getByRole('button').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, fits: node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1 };
    }));
    expect(boxes.every(box => box.fits && box.x >= chooserBox.x && box.right <= chooserBox.x + chooserBox.width
      && box.y >= chooserBox.y && box.bottom <= chooserBox.y + chooserBox.height)).toBe(true);
    expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].x);
    expect(boxes[1].right).toBeLessThanOrEqual(boxes[2].x);
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Tab'); await expect(chooser.getByRole('button', { name: '学習予定を追加', exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('home-add-chooser.png'), fullPage: true });
    await testInfo.attach('Home inline add choices', { path: testInfo.outputPath('home-add-chooser.png'), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(chooser.getByRole('button')).toHaveCount(1); await expect(add).toBeFocused();
    await add.click(); await close.click(); await expect(add).toHaveAttribute('aria-expanded', 'false');
    await add.click(); await browseAnotherDateThenHome(page);
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await add.click();
    await chooser.getByRole('button', { name: '予定を追加', exact: true }).click();
    const event = page.locator('.month-event-modal');
    await expect(event.getByRole('button', { name: '開始日', exact: true })).toContainText('2026年8月19日');
    await event.getByLabel('タイトル', { exact: true }).fill('ホームから予定');
    await event.getByRole('button', { name: '保存', exact: true }).click();
    await expect(event).toHaveCount(0); await expect(home).toBeVisible();
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから予定');
    await browseAnotherDateThenHome(page);
    await expectOriginalRowHeight(row);
    const populatedRow = await row.boundingBox();
    await add.click();
    expect(await row.boundingBox()).toEqual(populatedRow);
    for (const button of await row.getByRole('button').all()) {
      expect((await button.boundingBox()).height).toBeCloseTo(populatedRow.height, 1);
    }
    await chooser.getByRole('button', { name: '学習予定を追加', exact: true }).click();
    const study = page.getByRole('dialog', { name: '予定・記録の追加' });
    await expect(study.getByLabel('日付', { exact: true })).toHaveValue(E2E_TODAY);
    await study.getByPlaceholder('例: 英語課題 / 面接準備').fill('ホームから学習');
    await study.getByRole('button', { name: '30分', exact: true }).click();
    await study.getByRole('button', { name: '保存', exact: true }).click();
    await expect(study).toHaveCount(0); await expect(home).toBeVisible();
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから学習');
    await expect(page.locator('.schedule-month-view')).toHaveCount(0);
    await page.reload();
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから予定');
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから学習');
  });
}

for (const [width, appearance, theme, height = 844, relaxed = false, count = 0] of [
  [300, 'standard', 'light'], [320, 'pixel', 'dark'], [360, 'standard', 'dark'],
  [390, 'pixel', 'light'], [430, 'standard', 'light'], [768, 'pixel', 'dark'],
  [1280, 'standard', 'dark'],
  [390, 'standard', 'light', 1200, true, 0], [390, 'standard', 'light', 1200, true, 1],
  [1024, 'pixel', 'dark', 1366, true, 0], [1024, 'pixel', 'dark', 1366, true, 1],
]) {
  test(`Home inline choices fit ${width}x${height} ${appearance} ${theme} with ${count} plans`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ appearance, theme, count }) => {
      const now = new Date().toISOString();
      const user = { id: 'inline-layout-user', email: 'inline-layout@example.test', username: '表示確認', avatar: '', createdAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      localStorage.setItem('study-planner-appearance', appearance);
      localStorage.setItem('study-planner-theme-mode', theme);
      for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
      localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{ id: 'inline-layout-todo', userId: user.id, title: '表示確認の課題', subject: '', type: 'study', estimatedMinutes: 30, dueDate: '2026-08-20', memo: '', status: 'open', scheduledPlanId: null, createdAt: now, updatedAt: now }]));
      if (count) localStorage.setItem('studyplanner.plans', JSON.stringify([{
        id: 'inline-layout-plan', seriesId: 'inline-layout-plan', userId: user.id, title: '表示確認の予定', subject: '数学', type: 'study',
        date: new Date().toLocaleDateString('sv-SE'), startTime: '19:00', endTime: '20:00', memo: '',
        repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now,
      }]));
    }, { appearance, theme, count });
    await page.goto('/');
    const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
    const add = row.getByRole('button', { name: '今日の予定に追加', exact: true });
    await expect(add).toBeVisible();
    if (relaxed) await page.addStyleTag({ content: '.home-dashboard-default { --home-relax-row: 20px !important; --home-relax-schedule-side: 11px !important; }' });
    await row.scrollIntoViewIfNeeded();
    if (appearance === 'pixel') {
      await expect.poll(() => row.evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
      await page.evaluate(() => document.fonts.load('16px DotGothic16', '学習予定を追加'));
    }
    await expectOriginalRowHeight(row);
    await page.evaluate(() => document.fonts.ready);
    const closed = await row.boundingBox();
    // The whole original frame remains a tap target, including its top edge.
    await add.click({ position: { x: 4, y: 2 } });
    await expect(row.getByRole('button')).toHaveCount(3);
    const open = await row.boundingBox();
    expect(open.width).toBeCloseTo(closed.width, 1);
    expect(open.height).toBeCloseTo(closed.height, 1);
    const bounds = await row.evaluate(element => {
      const frame = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll('button')).map(button => {
        const box = button.getBoundingClientRect();
        const label = button.querySelector('span');
        const text = label?.getBoundingClientRect();
        return { label: button.textContent, fullHeight: Math.abs(box.height - frame.height) < 1,
          inside: box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom,
          textInside: !text || (text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom),
          noOverflow: button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1 };
      });
    });
    expect(bounds.every(bound => bound.fullHeight && bound.inside && bound.textInside && bound.noOverflow), JSON.stringify(bounds)).toBe(true);
    await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: '学習予定を追加', exact: true })).toBeVisible();
    await testInfo.attach(`inline-${width}-${appearance}-${theme}`, { body: await row.screenshot(), contentType: 'image/png' });
    await page.getByRole('heading', { name: '今日の予定', exact: true }).click();
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await add.press('Space');
    await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByRole('button')).toHaveCount(1);
  });
}
