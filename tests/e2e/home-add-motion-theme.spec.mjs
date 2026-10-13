import { expect, test } from './support/fixed-clock.mjs';
import { seedHomeAdd } from './support/home-add-fixture.mjs';
import { waitForVisualReady } from './support/ui-regression.mjs';

async function seedHome(page, { appearance = 'standard', theme = 'light', palette = 'forest' } = {}) {
  await seedHomeAdd(page);
  await page.addInitScript(({ appearance, theme, palette }) => {
    localStorage.setItem('study-planner-appearance', appearance);
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('study-planner-theme-palette', palette);
  }, { appearance, theme, palette });
  await page.goto('/');
  const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
  await expect(row).toBeVisible();
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

async function finishMotion(row) {
  await row.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
}

// Advance the browser's real CSS transitions, rather than sleeping and merely
// asserting the final state. Sampled controls retain their original hit boxes.
async function toggleAtMidpoint(row) {
  return row.evaluate(async element => {
    const action = element.querySelector('.home-add-action');
    const trigger = element.querySelector('.home-add-toggle');
    const before = Number(getComputedStyle(action).opacity);
    trigger.click();
    await new Promise(requestAnimationFrame);
    getComputedStyle(action).opacity;
    const transitions = element.getAnimations({ subtree: true });
    const fade = transitions.find(animation => animation.effect.target === action && animation.transitionProperty === 'opacity');
    for (const animation of transitions) {
      animation.pause();
      animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    }
    return {
      before,
      opacity: Number(getComputedStyle(action).opacity),
      fadeDuration: fade?.effect.getTiming().duration,
      iconTransform: getComputedStyle(trigger.querySelector('svg')).transform,
      disabled: action.disabled,
      hidden: action.getAttribute('aria-hidden'),
      expanded: trigger.getAttribute('aria-expanded'),
    };
  });
}

for (const width of [320, 1280]) {
  test(`Home add transitions both ways and reverses without moving the row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const row = await seedHome(page);
    const original = await row.boundingBox();
    expect(await row.getByRole('button', { name: '今日の予定に追加', exact: true }).boundingBox()).toEqual(original);
    const opening = await toggleAtMidpoint(row);
    expect(opening.before).toBe(0);
    expect(opening.fadeDuration).toBe(180);
    expect(opening.opacity).toBeGreaterThan(0);
    expect(opening.opacity).toBeLessThan(1);
    expect(opening.disabled).toBe(false);
    expect(opening.iconTransform).not.toBe('none');
    expect(await row.boundingBox()).toEqual(original);
    await finishMotion(row);
    await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    const closing = await toggleAtMidpoint(row);
    expect(closing.before).toBe(1);
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
    expect(reversing.before).toBeGreaterThan(0);
    expect(reversing.before).toBeLessThan(1);
    expect(reversing.opacity).toBeGreaterThan(reversing.before);
    expect(reversing.expanded).toBe('true');
    await finishMotion(row);
    await page.keyboard.press('Escape');
    await finishMotion(row);
    await expect(row.getByRole('button', { name: '今日の予定に追加', exact: true })).toBeFocused();
    await expect(row.locator('.home-add-action').first()).toHaveCSS('opacity', '0');
    await expect(row.locator('.home-add-action').first()).toHaveCSS('visibility', 'hidden');
    expect(await row.boundingBox()).toEqual(original);
    expect(await row.getByRole('button', { name: '今日の予定に追加', exact: true }).boundingBox()).toEqual(original);
  });

  test(`Home add reduced motion is immediate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const row = await seedHome(page);
    for (const open of [true, false, true, false]) {
      const state = await row.evaluate(async element => {
        element.querySelector('.home-add-toggle').click();
        // React has committed by the next frame; no motion duration is waited.
        await new Promise(requestAnimationFrame);
        const action = element.querySelector('.home-add-action');
        return { opacity: getComputedStyle(action).opacity, duration: getComputedStyle(action).transitionDuration,
          animations: element.getAnimations({ subtree: true }).length, disabled: action.disabled };
      });
      expect(state).toEqual({ opacity: open ? '1' : '0', duration: '0s', animations: 0, disabled: !open });
    }
  });
}

for (const appearance of ['standard', 'pixel']) {
  for (const theme of ['light', 'dark']) {
    for (const palette of ['forest', 'ocean', 'sakura', 'amber', 'violet']) {
      test(`Home add shares Calendar colors: ${appearance} ${theme} ${palette}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const row = await seedHome(page, { appearance, theme, palette });
        await row.getByRole('button', { name: '今日の予定に追加', exact: true }).click();
        await finishMotion(row);
        await page.mouse.move(0, 0);
        const colors = await row.evaluate(element => {
          // Use the actual Calendar classes as the reference, in the same theme
          // cascade, without involving navigation or touching saved data.
          const reference = document.createElement('div');
          reference.innerHTML = '<button class="daily-add-fab schedule-add-fab"></button><span class="quick-add-option-icon"></span>';
          document.body.append(reference);
          const paint = node => { const style = getComputedStyle(node); return { color: style.color, background: style.backgroundColor }; };
          const result = { trigger: paint(element.querySelector('.home-add-toggle')), action: paint(element.querySelector('.home-add-action')),
            calendarTrigger: paint(reference.firstElementChild), calendarAction: paint(reference.lastElementChild) };
          reference.remove();
          return result;
        });
        expect(colors.trigger).toEqual(colors.calendarTrigger);
        expect(colors.action).toEqual(colors.calendarAction);
        const screenshot = testInfo.outputPath('home-add-theme.png');
        await row.screenshot({ path: screenshot });
        await testInfo.attach(`${appearance}-${theme}-${palette}`, { path: screenshot, contentType: 'image/png' });
      });
    }
  }
}
