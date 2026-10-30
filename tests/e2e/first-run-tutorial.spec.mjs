import { expect, test } from './support/fixed-clock.mjs';

test.use({ skipFirstRunTutorial: false });

async function seedEmptyOwner(page) {
  await page.addInitScript(() => {
    const owner = { id: 'new-learner', email: 'learner@example.test', username: 'Learner', avatar: '', createdAt: new Date().toISOString() };
    localStorage.setItem('studyplanner.users', JSON.stringify([owner]));
    localStorage.setItem('studyplanner.session', owner.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`first-run slideshow is readable and does not require registering anything at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await seedEmptyOwner(page);
    await page.goto('/');
    const tour = page.getByRole('dialog', { name: 'Laplanceの使い方' });
    await expect(tour).toBeVisible();
    for (const title of ['勉強を、続けられる形に。', '目標も、毎日の予定も。', '予定どおりじゃなくてもいい。', '計画と実際を、見比べる。', '今日、全部決めなくて大丈夫。']) {
      await expect(tour.getByRole('heading', { name: title })).toBeVisible();
      expect(await tour.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(tour.getByRole('button', { name: title.startsWith('今日') ? 'ホームを見る' : '次へ' })).toBeInViewport({ ratio: 1 });
      if (title.startsWith('今日')) break;
      await tour.getByRole('button', { name: '次へ' }).click();
    }
    await page.screenshot({ path: testInfo.outputPath(`last-slide-${viewport.width}.png`) });
    await tour.getByRole('button', { name: 'ホームを見る' }).click();
    await expect(tour).toHaveCount(0);
    await expect(page.locator('.primary-bottom-nav')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.plans') ?? '[]'))).toEqual([]);
    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible();
    await expect(tour).toHaveCount(0);
  });
}

test('skips immediately without forcing plan creation', async ({ page }) => {
  await seedEmptyOwner(page);
  await page.goto('/');
  const tour = page.getByRole('dialog', { name: 'Laplanceの使い方' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'スキップ' }).click();
  await expect(tour).toHaveCount(0);
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
});
