import { expect, test } from './support/fixed-clock.mjs';

async function seed(page, corruptRestDays = false) {
  await page.addInitScript(({ corrupt }) => {
    if (localStorage.getItem('streak-calendar-seeded')) return;
    const user = { id: 'streak-calendar-user', email: 'streak@example.test', username: '学習テスト', avatar: '', createdAt: '2026-08-01T00:00:00Z' };
    const actuals = Array.from({ length: 7 }, (_, index) => ({ id: `study-${index}`, userId: user.id, planId: null,
      occurrenceDate: `2026-08-${11 + index}`, actualStartTime: '09:00', actualEndTime: '09:30',
      title: '英語の復習', subject: '英語', note: '', updatedAt: '2026-08-18T00:00:00Z' }));
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.actuals', JSON.stringify(actuals));
    for (const key of ['studyplanner.plans', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    if (corrupt) localStorage.setItem(`studyplanner.studyRestDays.v1:${user.id}`, '{broken');
    localStorage.setItem('streak-calendar-seeded', 'true');
  }, { corrupt: corruptRestDays });
}

for (const [width, height] of [[320, 568], [390, 844], [1280, 720]]) {
  test(`compact learning calendar and automatic rest day fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await seed(page); await page.goto('/');
    const entrance = page.getByRole('button', { name: /連続学習.*学習記録を開く/ });
    await expect(entrance.locator('.study-streak-flame')).toHaveCSS('animation-name', 'none');
    await entrance.click();
    const screen = page.getByRole('main', { name: '学習記録', exact: true });
    await expect(screen).toBeVisible();
    await expect(screen.getByRole('heading', { name: '学習記録', exact: true })).toBeFocused();
    await expect(screen.locator('.study-streak-flame')).toHaveCSS('animation-name', 'none');
    await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toHaveCount(0);
    await expect(screen.getByLabel('お休みチケット 0枚', { exact: true })).toBeVisible();
    await expect(screen.getByRole('cell', { name: '2026年8月11日、学習した日', exact: true })).toHaveClass(/is-study/);
    await screen.getByRole('button', { name: '前の月', exact: true }).click();
    await expect(screen.getByRole('heading', { name: '2026年7月' })).toBeVisible();
    await screen.getByRole('button', { name: '今日', exact: true }).click();
    await expect(screen.getByRole('button', { name: '次の月', exact: true })).toBeDisabled();
    await expect(screen.locator('input, form')).toHaveCount(0);
    await expect(screen.getByRole('cell', { name: '2026年8月18日、お休みチケット使用', exact: true })).toHaveClass(/is-protected/);
    await expect(screen.getByLabel('お休みチケット 0枚', { exact: true })).toBeVisible();
    await expect(screen.getByText('お休み券は自動で使います', { exact: true })).toHaveCount(0);
    await expect(screen.getByText('次の1枚まで 7日', { exact: true })).toBeVisible();
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.studyRestDays.v1:streak-calendar-user')));
    expect(data.dates).toEqual(['2026-08-18']);
    const layout = await screen.evaluate(element => {
      const content = element.querySelector('.study-streak-content');
      const protectedDay = element.querySelector('.is-protected .study-streak-day-mark');
      const studiedDay = element.querySelector('.is-study');
      return { overflow: content.scrollWidth > content.clientWidth, verticalOverflow: element.scrollHeight > element.clientHeight + 1, calendarRows: element.querySelectorAll('tbody tr').length, protectedShape: getComputedStyle(protectedDay).clipPath,
        studyColor: getComputedStyle(studiedDay).backgroundColor, restColor: getComputedStyle(protectedDay).backgroundColor,
        rowHeight: studiedDay.getBoundingClientRect().height,
        legendFontSize: parseFloat(getComputedStyle(element.querySelector('.study-streak-legend')).fontSize),
        progressFontSize: parseFloat(getComputedStyle(element.querySelector('.study-streak-ticket-note')).fontSize),
        controls: [...element.querySelectorAll('button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.protectedShape).toContain('polygon');
    expect(layout.studyColor).not.toBe(layout.restColor);
    expect(layout.verticalOverflow).toBe(false);
    expect(layout.calendarRows).toBe(6);
    expect(layout.rowHeight).toBeLessThanOrEqual(44);
    expect(layout.legendFontSize).toBeGreaterThanOrEqual(14);
    expect(layout.progressFontSize).toBeGreaterThanOrEqual(16);
    for (const control of layout.controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); }
    await page.screenshot({ path: testInfo.outputPath(`study-streak-${width}-light.png`), fullPage: true });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({ path: testInfo.outputPath(`study-streak-${width}-dark.png`), fullPage: true });
    if (width === 320) {
      for (const viewport of [{ width: 360, height: 640 }, { width: 568, height: 320 }]) {
        await page.setViewportSize(viewport);
        await expect.poll(() => screen.evaluate(element => ({ horizontal: element.scrollWidth > element.clientWidth + 1, vertical: element.scrollHeight > element.clientHeight + 1 }))).toEqual({ horizontal: false, vertical: false });
      }
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      // Text enlargement may scroll, but all controls remain reachable.
      await expect(screen.getByRole('button', { name: '今日', exact: true })).toBeVisible();
      await expect.poll(() => screen.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    }
    await screen.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(screen).toHaveCount(0);
    await expect(entrance).toBeFocused();
    await expect(entrance).toHaveAttribute('aria-label', '連続学習 7日、学習記録を開く');
    await page.goForward();
    await expect(screen).toBeVisible();
    await expect(screen.getByRole('cell', { name: '2026年8月18日、お休みチケット使用', exact: true })).toBeVisible();
    await page.reload();
    await expect(screen).toBeVisible();
    await expect(screen.getByLabel('お休みチケット 0枚', { exact: true })).toBeVisible();
  });
}

test('learning record read failure is not treated as zero tickets and can retry safely', async ({ page }) => {
  await seed(page, true); await page.goto('/');
  await page.getByRole('button', { name: /連続学習.*学習記録を開く/ }).click();
  const screen = page.getByRole('main', { name: '学習記録', exact: true });
  await expect(screen.getByRole('alert')).toBeVisible();
  await expect(screen.getByLabel('お休みチケット 確認中', { exact: true })).toHaveText('—枚');
  await expect(screen.getByRole('button', { name: 'チケットを使う', exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('studyplanner.studyRestDays.v1:streak-calendar-user'));
  await screen.getByRole('button', { name: '再読み込み', exact: true }).click();
  await expect(screen.getByLabel('お休みチケット 0枚', { exact: true })).toBeVisible();
  await expect(screen.getByRole('alert')).toHaveCount(0);
});


test('real study today animates both flames, respects reduced motion and stops after a correction', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('studyplanner.actuals'));
    records.push({ ...records[0], id: 'today-study', occurrenceDate: '2026-08-19' });
    localStorage.setItem('studyplanner.actuals', JSON.stringify(records));
  });
  await page.reload();
  const entrance = page.getByRole('button', { name: /連続学習.*学習記録を開く/ });
  const homeFlame = entrance.locator('.study-streak-flame');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(homeFlame).toHaveCSS('animation-name', 'study-streak-flame-sway');
  await entrance.click();
  const screen = page.getByRole('main', { name: '学習記録', exact: true });
  const detailFlame = screen.locator('.study-streak-flame');
  await expect(detailFlame).toHaveCSS('animation-name', 'study-streak-flame-sway');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(detailFlame).toHaveCSS('animation-name', 'none');
  await screen.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(homeFlame).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('studyplanner.actuals'));
    records.find(record => record.id === 'today-study').actualEndTime = '09:00';
    localStorage.setItem('studyplanner.actuals', JSON.stringify(records));
  });
  await page.reload();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(homeFlame).toHaveCSS('animation-name', 'none');
  await entrance.click();
  await expect(detailFlame).toHaveCSS('animation-name', 'none');
});
