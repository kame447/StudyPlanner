import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';
import { waitForVisualReady } from './support/ui-regression.mjs';

async function browseAnotherDateThenHome(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'ホーム' }).click();
}


async function waitForInlineMotion(row) {
  await row.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
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


async function expectLastPlanSeparator(row) {
  const styles = await row.evaluate(element => {
    const lastPlan = Array.from(element.parentElement.querySelectorAll('.home-schedule-row')).at(-1);
    if (!lastPlan) throw new Error('A populated Today list is required');
    const timeline = getComputedStyle(lastPlan, '::before');
    return { border: getComputedStyle(lastPlan).borderBottomWidth,
      timelineDisplay: timeline.display, timelineContent: timeline.content, timelineBorder: timeline.borderLeftWidth,
      followedByAddControl: lastPlan.nextElementSibling === element };
  });
  expect(styles.followedByAddControl).toBe(true);
  expect(styles.border).toBe('1px');
  expect(styles.timelineDisplay).not.toBe('none');
  expect(styles.timelineContent).not.toBe('none');
  expect(styles.timelineBorder).toBe('1px');
}

async function scrollOffsets(row) {
  return row.evaluate(element => {
    const offsets = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      offsets.push({ tag: parent.tagName, className: parent.className, top: parent.scrollTop, left: parent.scrollLeft });
    }
    return offsets;
  });
}

async function prepareInlinePointer(page, add, testInfo, phase) {
  // Settle Home before revealing the control: a later layout pass can change
  // the scrollport without changing the row's own box. Do not pre-hover/focus.
  await waitForVisualReady(page, '.home-inline-add');
  await add.scrollIntoViewIfNeeded();
  const containment = await add.evaluate(element => new Promise(resolve => {
    const observer = new IntersectionObserver(([entry]) => {
      observer.disconnect();
      const ancestors = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        ancestors.push({ tag: parent.tagName, className: parent.className,
          rect: parent.getBoundingClientRect().toJSON(), overflowX: style.overflowX, overflowY: style.overflowY,
          clientWidth: parent.clientWidth, clientHeight: parent.clientHeight,
          scrollWidth: parent.scrollWidth, scrollHeight: parent.scrollHeight,
          scrollTop: parent.scrollTop, scrollLeft: parent.scrollLeft });
      }
      resolve({ ratio: entry.intersectionRatio, target: entry.boundingClientRect.toJSON(),
        visible: entry.intersectionRect.toJSON(), root: entry.rootBounds?.toJSON(), ancestors });
    });
    observer.observe(element);
  }));
  // Native intersection is diagnostic, not the layout acceptance contract.
  // Preserve it before the ordinary click and the exact geometry assertions.
  await testInfo.attach(`${phase}-native-intersection`, {
    contentType: 'application/json', body: JSON.stringify(containment),
  });
  return containment;
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
    const closedContainment = await prepareInlinePointer(page, add, testInfo, 'empty');
    const closedBox = await row.boundingBox();
    const closedScroll = await scrollOffsets(row);
    await add.click();
    const chooser = row;
    const close = chooser.getByRole('button', { name: '予定の追加を閉じる', exact: true });
    await expect(chooser.getByRole('button')).toHaveCount(3);
    await expect(chooser.locator('.lucide-calendar-plus')).toHaveCount(1);
    await expect(chooser.locator('.lucide-book-open-check')).toHaveCount(1);
    await expect(close.locator('.lucide-plus')).toHaveCount(1);
    await expect(close).toHaveClass(/is-open/);
    await expect(chooser.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.home-add-sheet, .home-add-overlay')).toHaveCount(0);
    const chooserBox = await chooser.boundingBox();
    const chooserScroll = await scrollOffsets(row);
    await testInfo.attach('empty-inline-position', { contentType: 'application/json', body: JSON.stringify({
      before: { box: closedBox, scroll: closedScroll, containment: closedContainment },
      after: { box: chooserBox, scroll: chooserScroll },
    }) });
    expect(chooserBox).toEqual(closedBox);
    expect(chooserScroll).toEqual(closedScroll);
    await waitForInlineMotion(row);
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
    await expect(event).toBeVisible();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await event.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(event).toHaveCount(0);
    await expect(chooser.getByRole('button')).toHaveCount(3);
    await chooser.getByRole('button', { name: '予定を追加', exact: true }).click();
    await expect(event.getByRole('button', { name: '開始日', exact: true })).toContainText('2026年8月19日');
    await event.getByLabel('タイトル', { exact: true }).fill('ホームから予定');
    await event.getByRole('button', { name: '保存', exact: true }).click();
    await expect(event).toHaveCount(0); await expect(home).toBeVisible();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(chooser.getByRole('button')).toHaveCount(3);
    await expect(home.locator('.home-schedule-list')).toContainText('ホームから予定');
    await browseAnotherDateThenHome(page);
    await expectOriginalRowHeight(row);
    await expectLastPlanSeparator(row);
    // Measure after the temporary row probe, settled layout and final reveal;
    // the ordinary click must still preserve geometry through hover/focus/open.
    const populatedContainment = await prepareInlinePointer(page, add, testInfo, 'populated');
    const populatedRow = await row.boundingBox();
    const populatedScroll = await scrollOffsets(row);
    await add.click();
    const expandedRow = await row.boundingBox();
    const expandedScroll = await scrollOffsets(row);
    await testInfo.attach('populated-inline-position', { contentType: 'application/json', body: JSON.stringify({
      before: { box: populatedRow, scroll: populatedScroll, containment: populatedContainment },
      after: { box: expandedRow, scroll: expandedScroll },
    }) });
    expect(expandedRow).toEqual(populatedRow);
    expect(expandedScroll).toEqual(populatedScroll);
    await expectLastPlanSeparator(row);
    await waitForInlineMotion(row);
    for (const button of await row.getByRole('button').all()) {
      expect((await button.boundingBox()).height).toBeCloseTo(populatedRow.height, 1);
    }
    await chooser.getByRole('button', { name: '学習予定を追加', exact: true }).click();
    const study = page.getByRole('dialog', { name: '予定・記録の追加' });
    await expect(study).toBeVisible();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await study.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(study).toHaveCount(0);
    await expect(chooser.getByRole('button')).toHaveCount(3);
    await chooser.getByRole('button', { name: '学習予定を追加', exact: true }).click();
    await expect(study.getByLabel('日付', { exact: true })).toHaveValue(E2E_TODAY);
    await study.getByPlaceholder('例: 英語課題 / 面接準備').fill('ホームから学習');
    await study.getByRole('button', { name: '30分', exact: true }).click();
    await study.getByRole('button', { name: '保存', exact: true }).click();
    await expect(study).toHaveCount(0); await expect(home).toBeVisible();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(chooser.getByRole('button')).toHaveCount(3);
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
    if (count) await expectLastPlanSeparator(row);
    await add.scrollIntoViewIfNeeded();
    await waitForVisualReady(page, '.home-inline-add');
    const closed = await row.boundingBox();
    // The whole original frame remains a tap target, including its top edge.
    await add.click({ position: { x: 4, y: 2 } });
    await expect(row.getByRole('button')).toHaveCount(3);
    const open = await row.boundingBox();
    if (count) await expectLastPlanSeparator(row);
    expect(open.width).toBeCloseTo(closed.width, 1);
    expect(open.height).toBeCloseTo(closed.height, 1);
    await waitForInlineMotion(row);
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
    const screenshot = testInfo.outputPath('home-add-chooser.png');
    await row.screenshot({ path: screenshot });
    await testInfo.attach(`inline-${width}-${appearance}-${theme}`, { path: screenshot, contentType: 'image/png' });
    const close = row.getByRole('button', { name: '予定の追加を閉じる', exact: true });
    await page.getByRole('heading', { name: '今日の予定', exact: true }).click();
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await close.press('Space');
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await add.press('Space');
    await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(row.getByRole('button')).toHaveCount(3);
    await close.press('Escape');
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByRole('button')).toHaveCount(1);
  });
}
