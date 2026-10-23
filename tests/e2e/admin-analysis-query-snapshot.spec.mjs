import { expect, test } from '@playwright/test';

test('AI analysis hides the old query through failure, retry, and a date change', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin-overview.html?view=ai&state=query-ownership&from=2026-10-07&to=2026-10-13');
  const cards = page.locator('.admin-overview-metric');
  const requestCount = cards.first().locator('strong');
  const requests = () => page.evaluate(() => window.__adminAnalysisRequests?.map((request) => request.query) ?? []);
  const resolve = (index, count) => page.evaluate(({ index, count }) => {
    window.__adminAnalysisRequests[index].resolve(count);
  }, { index, count });

  await expect.poll(requests).toEqual([{ fromDate: '2026-10-07', toDate: '2026-10-13', environment: 'production' }]);
  await resolve(0, 101);
  await expect(requestCount).toHaveText('101');

  const environment = page.locator('.admin-overview-controls').getByRole('combobox');
  await expect(environment).toHaveValue('production');
  await environment.selectOption('preview');
  await expect(environment).toHaveValue('preview');
  await expect.poll(async () => (await requests()).length).toBe(2);
  await expect(cards).toHaveCount(0);
  await page.evaluate(() => window.__adminAnalysisRequests[1].reject());
  await expect(page.getByRole('alert')).toContainText('Harness current analysis unavailable.');
  await expect(cards).toHaveCount(0);

  await page.getByRole('button', { name: '更新', exact: true }).click();
  await expect.poll(async () => (await requests()).length).toBe(3);
  expect((await requests())[2]).toEqual({ fromDate: '2026-10-07', toDate: '2026-10-13', environment: 'preview' });
  await resolve(2, 202);
  await expect(requestCount).toHaveText('202');
  await expect(page.getByText('Harness current analysis unavailable.')).toHaveCount(0);

  await page.getByLabel('開始日', { exact: true }).fill('2026-10-08');
  await expect.poll(async () => (await requests()).length).toBe(4);
  expect((await requests())[3]).toEqual({ fromDate: '2026-10-08', toDate: '2026-10-13', environment: 'preview' });
  await expect(cards).toHaveCount(0);
  await resolve(3, 303);
  await expect(requestCount).toHaveText('303');
});
