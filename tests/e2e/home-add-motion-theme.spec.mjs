import { expect, test } from './support/fixed-clock.mjs';
import { seedHome, finishMotion, verifyHomeAddMotion } from './support/home-add-motion-checks.mjs';

for (const [width, appearance, theme, count] of [
  [320, 'standard', 'light', 0], [390, 'pixel', 'dark', 1], [1280, 'standard', 'dark', 1],
]) {
  test(`Home add transitions both ways and reverses without moving the row at ${width}px`, async ({ page }, testInfo) => {
    await verifyHomeAddMotion(page, testInfo, { width, appearance, theme, count });
  });

  test(`Home add reduced motion is immediate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const row = await seedHome(page, { appearance, theme, count });
    for (const open of [true, false, true, false]) {
      const state = await row.evaluate(async element => {
        element.querySelector('.home-add-toggle').click();
        // React has committed by the next frame; no motion duration is waited.
        await new Promise(requestAnimationFrame);
        const action = element.querySelector('.home-add-action');
        return { opacity: getComputedStyle(action).opacity, duration: getComputedStyle(action).transitionDuration,
          animations: element.getAnimations({ subtree: true }).length, disabled: action.disabled,
          width: element.querySelector('.home-add-toggle').getBoundingClientRect().width,
          rowWidth: element.getBoundingClientRect().width, transform: getComputedStyle(action).transform };
      });
      expect(state).toMatchObject({ opacity: open ? '1' : '0', duration: '0s', animations: 0, disabled: !open });
      expect(state.width).toBe(open ? 44 : state.rowWidth);
      if (open) expect(state.transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
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
