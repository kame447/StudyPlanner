import { test, expect } from './support/fixed-clock.mjs';
const TITLE = '情報資源総論の重要事項を確認する学習予定'.repeat(6);
async function seed(page, planCount = 1) {
  await page.addInitScript(({ title, planCount }) => {
    const now = new Date().toISOString(), date = new Date().toLocaleDateString('sv-SE');
    const user = { id: 'home-content-qa', email: 'home-content@example.test', username: '表示確認', avatar: '', createdAt: now };
    const plan = { id: 'qa-plan', seriesId: 'qa-plan', userId: user.id, title, subject: '情報科学', type: 'study', date, startTime: '19:00', endTime: '20:00', memo: '', recurrence: null, createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(Array.from({ length: planCount }, (_, index) => ({ ...plan, id: index === 0 ? plan.id : `qa-plan-${index}`, seriesId: index === 0 ? plan.seriesId : `qa-plan-${index}` }))));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
  }, { title: TITLE, planCount });
}
async function separated(page) {
  await expect.poll(() => page.evaluate(() => {
    const r = selector => document.querySelector(selector).getBoundingClientRect();
    const home = document.querySelector('.home-main > .home-dashboard-default');
    const hero = r('.home-next-card'), actions = r('.home-actions');
    return { noHomeHorizontalOverflow: home.scrollWidth <= home.clientWidth + 1,
      actionsContained: actions.left >= hero.left && actions.right <= hero.right + 1 && actions.bottom <= hero.bottom + 1,
      metaBeforeCta: r('.home-next-meta').bottom <= r('.home-start-button').top - 2,
      todayBeforeAttention: r('.home-today-panel').bottom <= r('.home-alert-grid').top + 1,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 };
  })).toEqual({ noHomeHorizontalOverflow: true, actionsContained: true, metaBeforeCta: true, todayBeforeAttention: true, noHorizontalOverflow: true });
}
async function actions(page) {
  const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
  await add.scrollIntoViewIfNeeded(); await add.click({ trial: true, timeout: 5000 }); await add.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('group', { name: '今日の予定の追加', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '予定の追加を閉じる', exact: true }).click();
  await expect(add).toHaveAttribute('aria-expanded', 'false'); await expect(add).toBeFocused();
  for (const target of [page.locator('.home-alert-card').last(), page.locator('.home-start-button')]) {
    await target.scrollIntoViewIfNeeded(); await target.click({ trial: true, timeout: 5000 }); await target.focus(); await expect(target).toBeFocused();
  }
}
for (const [width,height] of [[360,640],[390,844],[412,915],[430,932],[768,1024],[1024,768],[1280,720],[1440,900],[1920,1080]]) {
  test(`${width}x${height} long title retains metadata and reads full text`, async ({page},info) => {
    await page.setViewportSize({width,height}); await seed(page); await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible(); await separated(page);
    const trigger = page.getByRole('button', {name:TITLE,exact:true});
    await expect(page.locator('[data-home-section="next-plan"]').getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
    await expect(trigger).toHaveAccessibleDescription('予定名の全文を読む');
    expect(await trigger.evaluate(e=>e.getBoundingClientRect().height<=2*parseFloat(getComputedStyle(e).lineHeight)+1)).toBe(true);
    const saved = await page.evaluate(()=>localStorage.getItem('studyplanner.plans'));
    await page.screenshot({path:info.outputPath('home.png')});
    await trigger.click(); const dialog = page.getByRole('dialog',{name:'予定名の全文',exact:true});
    await expect(dialog).toContainText(TITLE);
    await expect(dialog.getByRole('button',{name:'閉じる',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true);
    expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    await page.keyboard.press('Space'); await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'閉じる',exact:true}).click(); await expect(trigger).toBeFocused();
    await actions(page); expect(await page.evaluate(()=>localStorage.getItem('studyplanner.plans'))).toBe(saved);
  });
}
async function checkEnlargedText(page, info, width, height, rotate) {
  await page.setViewportSize({ width, height });
  await seed(page); await page.goto('/');
  const home = page.locator('.home-main > .home-dashboard-default');
  await expect(home).toBeVisible();
  const style = await page.addStyleTag({ content: ':root {font-size:200%!important}' });
  await actions(page); await expect(home).toHaveAttribute('data-content-scroll', 'true');
  await separated(page); await actions(page);
  await page.screenshot({ path: info.outputPath('text200.png') });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1)).toBe(true);
  if (rotate) {
    await page.setViewportSize({ width: 390, height: 844 });
    // Confirm the CSS layout viewport really changed before claiming rotation coverage.
    await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(390);
    await separated(page); await actions(page);
  }
  await style.evaluate(element => element.remove());
  await expect(home).not.toHaveAttribute('data-content-scroll', 'true');
  await separated(page); await actions(page);
}

for (const [width, height] of [[360, 800], [768, 1024], [1280, 800]]) {
  test(`${width}px enlarged text and font-only recovery at the same viewport`, async ({ page }, info) => {
    await checkEnlargedText(page, info, width, height, false);
  });
  test(`${width}px rotation preserves enlarged text and font-only recovery`, async ({ page, browserName }, info) => {
    test.skip(browserName === 'webkit' && info.project.use.isMobile === true,
      'WebKit mobile setViewportSize leaves the CSS viewport unchanged, reproduced in minimal HTML; real-device rotation remains unverified.');
    await checkEnlargedText(page, info, width, height, true);
  });
}

for (const width of [390, 1280]) {
  test(`${width}px retained title dialog yields to settings during history navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seed(page); await page.goto('/');
    await expect(page.locator('.home-main')).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('studyplanner.plans'));
    await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
    const settings = page.getByRole('main', { name: 'アプリ設定' });
    await expect(settings).toBeVisible();
    await page.goBack(); await expect(settings).toHaveCount(0);
    const trigger = page.getByRole('button', { name: TITLE, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '予定名の全文', exact: true });
    await expect(dialog).toBeVisible();
    await page.goForward(); await expect(settings).toBeVisible();
    await expect(dialog).toBeHidden();
    await settings.getByRole('tab', { name: '設定', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(settings.getByRole('tabpanel')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.goBack(); await expect(settings).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(TITLE);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.plans'))).toBe(saved);
  });
}


for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    test(`desktop ${width}x${height} ${theme} uses readable columns inside one viewport`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await seed(page, 10);
      await page.addInitScript(theme => localStorage.setItem('study-planner-theme-mode', theme), theme);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const home = page.locator('.home-main > .home-dashboard-default');
      await expect(home).toBeVisible();
      await expect(home.locator(':scope > .home-material-panel')).toBeVisible();
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }));
      expect(viewport).toMatchObject({ width, height });
      await info.attach('desktop-viewport', { body: JSON.stringify(viewport), contentType: 'application/json' });
      await separated(page);
      await expect.poll(() => home.evaluate(element => {
        const next = element.querySelector('.home-next-card').getBoundingClientRect();
        const today = element.querySelector('.home-today-panel').getBoundingClientRect();
        const title = element.querySelector('.home-next-copy h1');
        const meta = element.querySelector('.home-next-meta');
        return {
          columns: Math.abs(next.top - today.top) <= 1 && next.right + 8 <= today.left,
          titleReadable: parseFloat(getComputedStyle(title).fontSize) >= 24,
          metadataReadable: parseFloat(getComputedStyle(meta).fontSize) >= 14,
          bodyFits: element.scrollHeight <= element.clientHeight + 1,
          bodyWidthFits: element.scrollWidth <= element.clientWidth + 1,
          documentFits: document.documentElement.scrollHeight <= window.innerHeight + 1,
          noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
      })).toEqual({ columns: true, titleReadable: true, metadataReadable: true, bodyFits: true, bodyWidthFits: true, documentFits: true, noHorizontalOverflow: true });
      await info.attach('desktop-home-geometry', {
        body: JSON.stringify(await home.evaluate(element => ({
          theme: document.documentElement.dataset.theme,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          home: { rect: element.getBoundingClientRect().toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight },
          cards: Object.fromEntries(['.home-next-card', '.home-today-panel', '.home-alert-grid', '.home-progress-panel', '.home-actions'].map(selector => [selector, element.querySelector(selector).getBoundingClientRect().toJSON()])),
          titleFontSize: getComputedStyle(element.querySelector('.home-next-copy h1')).fontSize,
          metadataFontSize: getComputedStyle(element.querySelector('.home-next-meta')).fontSize,
        }))),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath(`desktop-home-${width}-${theme}.png`) });
      const list = home.locator('.home-schedule-list');
      await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(page.getByRole('button', { name: '今日の予定に追加', exact: true })).toBeInViewport();
      await actions(page);
    });
  }
}
