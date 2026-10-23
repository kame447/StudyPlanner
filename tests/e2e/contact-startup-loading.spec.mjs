import { expect, test } from './support/fixed-clock.mjs';

for (const width of [390, 1280]) {
  test(`contact keeps navigation while its optional code loads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let release;
    const delivery = new Promise(resolve => { release = resolve; });
    const requested = [];
    await page.route('**/ContactPageContent-*.js', async route => {
      requested.push(route.request().url());
      await delivery;
      await route.continue();
    });
    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: '利用規約', exact: true })).toBeVisible();
    expect(requested).toHaveLength(0);
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status')).toHaveAccessibleName('お問い合わせを読み込み中');
    await expect(page.getByRole('status')).toHaveText('');
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    const back = page.getByRole('link', { name: 'Laplanceへ戻る', exact: true });
    await expect(back).toBeFocused();
    await expect.poll(() => requested.length).toBe(1);
    const backNode = await back.elementHandle();
    release();
    await expect(page.getByRole('alert')).toHaveText('現在、お問い合わせに接続できません。');
    expect(await backNode.evaluate(node => node === document.querySelector('.legal-back-link'))).toBe(true);
    await expect(back).toBeFocused();
    await back.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
    expect(requested).toHaveLength(1);
  });

  test(`contact can return after optional code delivery fails at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/ContactPageContent-*.js', route => route.abort('failed'));
    await page.goto('/contact');
    await expect(page.getByRole('alert')).toHaveText('お問い合わせを読み込めませんでした。再読み込みしてください。');
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Laplanceへ戻る', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toHaveCount(0);
  });
}
