import { expect, test } from '@playwright/test';

// Full production hook/controller/semantic validation/scheduler/renderer/reducer/UI.
// Only provider wire replies are authored fixtures; no real-model naturalness claim.
async function open(page, scenario) {
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00.000Z'));
  await page.goto(`/weekly-real-scenarios.html?scenario=${scenario}`);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
}
async function send(page, index, sequence = index + 1) {
  const text = await page.evaluate(index => window.__weeklyCampaign.texts[index], index);
  const input = page.locator('.ai-planning-composer textarea');
  await input.fill(text);
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__weeklyCampaign.measurements().at(-1)?.sequence)).toBe(sequence);
  await expect(input).toBeEnabled();
  const measurement = await page.evaluate(() => window.__weeklyCampaign.measurements().at(-1));
  expect(measurement).toMatchObject({ status: 'committed', failureCode: null, aiDispatches: { total: 2, semantic: 1, renderer: 1 } });
  const metrics = page.getByTestId('architecture-eval-metrics');
  await expect(metrics.locator('[data-metric="ai-dispatches"]')).toHaveAttribute('data-value', '2');
  await expect(metrics.locator('[data-metric="mode"]')).toHaveAttribute('data-architecture', measurement.architecture);
  await expect(metrics.locator('[data-metric="elapsed-ms"]')).toHaveAttribute('data-value', String(measurement.elapsedMs));
  expect(await page.evaluate(() => window.__weeklyCampaign.failures)).toEqual([]);
  return page.evaluate(() => window.__weeklyCampaign.state.previewCandidates ?? []);
}
async function checkPreview(page, candidates, testInfo) {
  expect(candidates.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(candidates.length);
  // Verify actual rendered blocks, not only the exposed state snapshot.
  const rendered = await preview.locator('.ai-planning-draft-block').allTextContents();
  for (const entry of candidates) {
    expect(rendered.some(text => text.includes(entry.startTime) && text.includes(entry.endTime))).toBe(true);
  }
  const box = await preview.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__weeklyCampaign.saved)).toEqual([]);
  const firstBlock = preview.locator('.ai-planning-draft-block').first();
  await firstBlock.scrollIntoViewIfNeeded();
  await expect(firstBlock).toBeInViewport();
  // Finish finite sheet-entry animations so artifacts show the settled preview.
  await page.screenshot({ path: testInfo.outputPath('preview.png'), fullPage: true, animations: 'disabled' });
}
for (const scenario of ['A', 'C', 'D', 'F']) {
  test(`${scenario}: corrected real-runtime preview and measured dispatches`, async ({ page }, testInfo) => {
    await open(page, scenario);
    const count = await page.evaluate(() => window.__weeklyCampaign.texts.length);
    let candidates = [];
    let beforeCorrection;
    for (let index = 0; index < count; index += 1) {
      candidates = await send(page, index);
      if (scenario === 'C' && index === 0) beforeCorrection = candidates;
      if (scenario === 'F' && index >= 1) expect(candidates.reduce((total, entry) => total + entry.durationMinutes, 0)).toBe(120);
    }
    expect(candidates.every(entry => entry.date >= '2026-10-12' && entry.date <= '2026-10-18')).toBe(true);
    if (scenario === 'A') expect(candidates.every(entry => entry.date <= '2026-10-16' && entry.startTime >= '20:00')).toBe(true);
    if (scenario === 'C') {
      expect(candidates).not.toEqual(beforeCorrection);
      expect(candidates.every(entry => entry.date <= '2026-10-16')).toBe(true);
      expect(candidates.map(entry => entry.title).join(' ')).not.toContain('30ページ');
      expect(candidates.map(entry => entry.title).join(' ')).toContain('20ページ');
    }
    if (scenario === 'D') {
      expect(candidates).toHaveLength(3);
      expect(candidates.filter(entry => entry.title.includes('卒業研究ノート')).map(entry => entry.durationMinutes)).toEqual([60, 60]);
    }
    if (scenario === 'D' || scenario === 'F') expect(candidates.every(entry => entry.startTime >= '18:00')).toBe(true);
    if (scenario === 'F') expect(candidates.map(entry => entry.durationMinutes)).toEqual([60, 60]);
    await checkPreview(page, candidates, testInfo);
  });
}

test('selector pins the actual runtime, changing preference only affects a new conversation; reload retains it', async ({ page }) => {
  await open(page, 'C');
  await send(page, 0);
  await expect(page.getByTestId('architecture-eval-mode')).toHaveAttribute('data-architecture', 'interaction_v1');
  await page.getByTestId('campaign-settings').click();
  await page.getByRole('radio', { name: '旧Stable V5' }).click();
  await page.getByRole('button', { name: '設定を閉じる' }).click();
  await send(page, 1);
  await expect(page.getByTestId('architecture-eval-mode')).toHaveAttribute('data-architecture', 'interaction_v1');
  await page.reload();
  await expect(page.getByTestId('architecture-eval-mode')).toHaveAttribute('data-architecture', 'interaction_v1');
  await page.evaluate(() => window.__weeklyCampaign.reset());
  await expect(page.getByTestId('architecture-eval-mode')).toContainText('未固定');
  await send(page, 0, 1); // Measurements restart on page reload.
  await expect(page.getByTestId('architecture-eval-mode')).toHaveAttribute('data-architecture', 'legacy_v5');
  expect(await page.evaluate(() => window.__weeklyCampaign.calls.at(-2).response_format.json_schema.schema.properties.conversationActs)).toBeUndefined();
  expect(await page.evaluate(() => window.__weeklyCampaign.saved)).toEqual([]);
});
