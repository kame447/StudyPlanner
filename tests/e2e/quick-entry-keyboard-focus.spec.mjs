import { expect, test } from './support/fixed-clock.mjs';
import { seedHomeAdd } from './support/home-add-fixture.mjs';

for (const width of [390, 1280]) {
  test(`Home study entry contains keyboard focus and returns it after dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedHomeAdd(page);
    await page.goto('/');
    const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
    const add = row.getByRole('button', { name: '今日の予定に追加', exact: true });
    const action = row.getByRole('button', { name: '学習予定を追加', exact: true });
    const collapse = row.getByRole('button', { name: '予定の追加を閉じる', exact: true });
    const study = page.getByRole('dialog', { name: '予定・記録の追加', exact: true });

    await add.focus();
    await page.keyboard.press('Enter');
    await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    for (const dismissal of ['Escape', 'button']) {
      await expect(action).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(study).toBeFocused();
      await expect(study.getByPlaceholder('例: 英語課題 / 面接準備')).not.toBeFocused();

      const close = study.getByRole('button', { name: '閉じる', exact: true });
      // The initial non-input container must contain the first reverse Tab too.
      await page.keyboard.press('Shift+Tab');
      await expect.poll(() => study.evaluate(dialog => dialog.contains(document.activeElement)
        && document.activeElement !== dialog)).toBe(true);
      await expect(close).not.toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect.poll(() => study.evaluate(dialog => dialog.contains(document.activeElement)
        && document.activeElement !== dialog)).toBe(true);
      await expect(close).not.toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();

      await study.getByPlaceholder('例: 英語課題 / 面接準備').fill('未保存の入力');
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await close.click();
      await expect(study).toHaveCount(0);
      await expect(action).toBeFocused();
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      await expect(row).not.toContainText('未保存の入力');
    }
    await collapse.press('Escape');
    await expect(add).toBeFocused();
    await expect(row.getByRole('button')).toHaveCount(1);
  });
}
