import { expect } from './fixed-clock.mjs';
import { seedHomeAdd } from './home-add-fixture.mjs';
import { waitForVisualReady } from './ui-regression.mjs';

export async function seedHome(page, { appearance = 'standard', theme = 'light', palette = 'forest', count = 0 } = {}) {
  await seedHomeAdd(page, { populated: count > 0 });
  await page.addInitScript(({ appearance, theme, palette }) => {
    localStorage.setItem('study-planner-appearance', appearance);
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('study-planner-theme-palette', palette);
  }, { appearance, theme, palette });
  await page.goto('/');
  const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(count ? /home-schedule-add-row/ : /home-schedule-empty/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
  expect(await page.evaluate(() => localStorage.getItem('study-planner-theme-palette'))).toBe(palette);
  await row.scrollIntoViewIfNeeded();
  if (appearance === 'pixel') {
    await expect.poll(() => row.evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
    await page.evaluate(() => document.fonts.load('16px DotGothic16', '学習予定を追加'));
  }
  await waitForVisualReady(page, '.home-inline-add');
  return row;
}

export async function finishMotion(row) {
  await row.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
}

// Advance the browser's real CSS transitions, rather than sleeping and merely
// asserting the final state. The row stays fixed while its controls move inside it.
async function toggleAtMidpoint(row) {
  return row.evaluate(async element => {
    const action = element.querySelector('.home-add-action');
    const trigger = element.querySelector('.home-add-toggle');
    const sample = () => ({
      opacity: Number(getComputedStyle(action).opacity),
      width: trigger.getBoundingClientRect().width,
      actions: Array.from(element.querySelectorAll('.home-add-action')).map(button => {
        const transform = new DOMMatrixReadOnly(getComputedStyle(button).transform);
        return { translateX: transform.m41, scale: transform.a };
      }),
    });
    const before = sample();
    trigger.click();
    await new Promise(requestAnimationFrame);
    getComputedStyle(action).opacity;
    const transitions = element.getAnimations({ subtree: true });
    const fade = transitions.find(animation => animation.effect.target === action && animation.transitionProperty === 'opacity');
    const shrink = transitions.find(animation => animation.effect.target === trigger && animation.transitionProperty === 'width');
    const midpoint = Math.min(...transitions.map(animation => animation.effect.getTiming())
      .filter(timing => Number(timing.duration) > 0)
      .map(timing => Number(timing.delay) + Number(timing.duration) / 2));
    for (const animation of transitions) {
      animation.pause();
      // Use one shared elapsed time so the sample is a real point in the reveal.
      animation.currentTime = midpoint;
    }
    return {
      before, ...sample(), midpoint,
      fadeDuration: fade?.effect.getTiming().duration,
      widthDuration: shrink?.effect.getTiming().duration,
      iconTransform: getComputedStyle(trigger.querySelector('svg')).transform,
      disabled: action.disabled,
      hidden: action.getAttribute('aria-hidden'),
      expanded: trigger.getAttribute('aria-expanded'),
    };
  });
}

export async function verifyHomeAddMotion(page, testInfo, { width, appearance, theme, count }) {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const row = await seedHome(page, { appearance, theme, count });
  const original = await row.boundingBox();
  expect(await row.getByRole('button', { name: '今日の予定に追加', exact: true }).boundingBox()).toEqual(original);
  const opening = await toggleAtMidpoint(row);
  await testInfo.attach('Home add opening measurement', { contentType: 'application/json', body: JSON.stringify(opening) });
  expect(opening.before.opacity).toBe(0);
  expect(opening.widthDuration).toBe(320);
  expect(opening.width).toBeGreaterThan(44);
  expect(opening.width).toBeLessThan(opening.before.width);
  expect(opening.actions[0].translateX).toBeGreaterThan(0);
  expect(opening.actions[0].translateX).toBeLessThan(opening.before.actions[0].translateX);
  expect(opening.actions[1].translateX).toBeLessThan(0);
  expect(opening.actions[1].translateX).toBeGreaterThan(opening.before.actions[1].translateX);
  expect(opening.actions.every(action => action.scale > 0.72 && action.scale < 1)).toBe(true);
  expect(opening.fadeDuration).toBe(180);
  expect(opening.opacity).toBeGreaterThan(0);
  expect(opening.opacity).toBeLessThan(1);
  expect(opening.disabled).toBe(false);
  expect(opening.iconTransform).not.toBe('none');
  expect(await row.boundingBox()).toEqual(original);
  const screenshot = testInfo.outputPath('home-add-midpoint.png');
  await row.screenshot({ path: screenshot });
  await testInfo.attach('Home add opening midpoint', { path: screenshot, contentType: 'image/png' });
  await finishMotion(row);
  expect(await row.locator('.home-add-toggle').evaluate(element => element.getBoundingClientRect().width)).toBe(44);
  for (const action of await row.locator('.home-add-action').all()) {
    await expect(action).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  }
  await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
  const closing = await toggleAtMidpoint(row);
  expect(closing.before.opacity).toBe(1);
  expect(closing.width).toBeGreaterThan(44);
  expect(closing.width).toBeLessThan(original.width);
  expect(closing.actions[0].translateX).toBeGreaterThan(0);
  expect(closing.actions[1].translateX).toBeLessThan(0);
  expect(closing.actions.every(action => action.scale > 0.72 && action.scale < 1)).toBe(true);
  expect(closing.opacity).toBeGreaterThan(0);
  expect(closing.opacity).toBeLessThan(1);
  expect(closing.disabled).toBe(true);
  expect(closing.hidden).toBe('true');
  await expect(row.getByRole('button')).toHaveCount(1);
  const fadingActionsPassThrough = await row.evaluate(element => {
    const trigger = element.querySelector('.home-add-toggle');
    return Array.from(element.querySelectorAll('.home-add-action')).every(action => {
      const box = action.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === trigger;
    });
  });
  expect(fadingActionsPassThrough).toBe(true);
  expect(await row.boundingBox()).toEqual(original);
  // Reverse before closing finishes. The retained node continues from its
  // current opacity instead of being removed/recreated at an endpoint.
  const reversing = await toggleAtMidpoint(row);
  expect(reversing.before.opacity).toBeGreaterThan(0);
  expect(reversing.before.opacity).toBeLessThan(1);
  expect(reversing.opacity).toBeGreaterThan(reversing.before.opacity);
  expect(reversing.width).toBeLessThan(reversing.before.width);
  expect(reversing.width).toBeGreaterThan(44);
  expect(reversing.actions[0].translateX).toBeLessThan(reversing.before.actions[0].translateX);
  expect(reversing.actions[1].translateX).toBeGreaterThan(reversing.before.actions[1].translateX);
  await testInfo.attach('Home add intermediate motion', {
    contentType: 'application/json', body: JSON.stringify({ width, appearance, theme, count, opening, closing, reversing }),
  });
  expect(reversing.expanded).toBe('true');
  await finishMotion(row);
  await page.keyboard.press('Escape');
  await finishMotion(row);
  await expect(row.getByRole('button', { name: '今日の予定に追加', exact: true })).toBeFocused();
  await expect(row.locator('.home-add-action').first()).toHaveCSS('opacity', '0');
  await expect(row.locator('.home-add-action').first()).toHaveCSS('visibility', 'hidden');
  expect(await row.boundingBox()).toEqual(original);
  expect(await row.getByRole('button', { name: '今日の予定に追加', exact: true }).boundingBox()).toEqual(original);
}
