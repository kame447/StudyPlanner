import { test, expect } from './support/fixed-clock.mjs';
const TITLE = '情報資源総論の重要事項を確認する学習予定'.repeat(6);
async function seed(page) {
  await page.addInitScript(title => {
    const now = new Date().toISOString(), date = new Date().toLocaleDateString('sv-SE');
    const user = { id: 'home-content-qa', email: 'home-content@example.test', username: '表示確認', avatar: '', createdAt: now };
    const plan = { id: 'qa-plan', seriesId: 'qa-plan', userId: user.id, title, subject: '情報科学', type: 'study', date, startTime: '19:00', endTime: '20:00', memo: '', recurrence: null, createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
  }, TITLE);
}
async function separated(page) {
  await expect.poll(() => page.evaluate(() => {
    const r = selector => document.querySelector(selector).getBoundingClientRect();
    return { metaBeforeCta: r('.home-next-meta').bottom <= r('.home-start-button').top - 2,
      todayBeforeAttention: r('.home-today-panel').bottom <= r('.home-alert-grid').top + 1,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 };
  })).toEqual({ metaBeforeCta: true, todayBeforeAttention: true, noHorizontalOverflow: true });
}
async function actions(page) {
  const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
  await add.scrollIntoViewIfNeeded(); await add.click({ trial: true, timeout: 5000 }); await add.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '今日の予定に追加', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(add).toBeFocused();
  for (const target of [page.locator('.home-alert-card').last(), page.locator('.home-start-button')]) {
    await target.scrollIntoViewIfNeeded(); await target.click({ trial: true, timeout: 5000 }); await target.focus(); await expect(target).toBeFocused();
  }
}
for (const [width,height] of [[360,640],[390,844],[412,915],[430,932],[768,1024],[1024,768],[1280,720],[1920,1080]]) {
  test(`${width}x${height} long title retains metadata and reads full text`, async ({page},info) => {
    await page.setViewportSize({width,height}); await seed(page); await page.goto('/');
    await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible(); await separated(page);
    const trigger = page.getByRole('button', {name:`予定名の全文を読む: ${TITLE}`,exact:true});
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
for(const [width,height] of [[360,800],[768,1024],[1280,800]]) {
  test(`${width}px enlarged text and font-only recovery after rotation`, async({page},info)=>{
    await page.setViewportSize({width,height}); await seed(page); await page.goto('/'); await expect(page.locator('.home-main > .home-dashboard-default')).toBeVisible();
    const style=await page.addStyleTag({content:':root {font-size:200%!important}'});
    const home=page.locator('.home-main > .home-dashboard-default'); await actions(page); await expect(home).toHaveAttribute('data-content-scroll','true');
    await separated(page); await actions(page); await page.screenshot({path:info.outputPath('text200.png')});
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=document.documentElement.clientHeight+1)).toBe(true);
    await page.setViewportSize({width:390,height:844}); await separated(page); await actions(page);
    await style.evaluate(e=>e.remove()); await expect(home).not.toHaveAttribute('data-content-scroll','true');
    await separated(page); await actions(page);
  });
}
