import { expect } from '@playwright/test';

export async function expectCompactHomeReachable(page, testInfo, name, { browserName, isMobile }) {
  const body = page.locator('.home-main > .home-dashboard-default');
  const header = page.locator('.primary-app-header');
  const nav = page.locator('.primary-bottom-nav');
  const shell = page.locator('.app-shell');
  const bodyClipBounds = () => body.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + element.clientLeft, y: rect.top + element.clientTop,
      width: element.clientWidth, height: element.clientHeight };
  });
  const initialHeader = await header.boundingBox();
  const initialNav = await nav.boundingBox();
  await expect(body).toHaveCSS('overflow-y', 'auto');
  await expect(shell).toHaveCSS('overflow-x', 'clip');
  await expect(shell).toHaveCSS('overflow-y', 'clip');
  expect(await body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  if (browserName !== 'webkit' || !isMobile) {
    const bodyBox = await body.boundingBox();
    const before = await body.evaluate(element => element.scrollTop);
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  }

  const expectChromeStill = async () => {
    const diagnostic = await page.evaluate(() => ({
      document: { x: window.scrollX, y: window.scrollY },
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      ancestors: [...document.querySelectorAll('.app-shell, .home-main, .home-main > .home-dashboard-default')]
        .map(element => ({
          name: element.className, left: element.scrollLeft, top: element.scrollTop,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          overflowX: getComputedStyle(element).overflowX, overflowY: getComputedStyle(element).overflowY,
        })),
    }));
    expect(await header.boundingBox(), JSON.stringify(diagnostic)).toEqual(initialHeader);
    expect(await nav.boundingBox(), JSON.stringify(diagnostic)).toEqual(initialNav);
    expect(diagnostic.document).toEqual({ x: 0, y: 0 });
    expect(diagnostic.pageWidth).toBeLessThanOrEqual(diagnostic.viewportWidth + 1);
    for (const ancestor of diagnostic.ancestors) {
      expect(ancestor.left, JSON.stringify(diagnostic)).toBe(0);
      expect(ancestor.scrollWidth, JSON.stringify(diagnostic)).toBeLessThanOrEqual(ancestor.clientWidth + 1);
    }
    expect(diagnostic.ancestors[0].left).toBe(0);
    expect(diagnostic.ancestors[0].top).toBe(0);
  };
  await expectChromeStill();
  // Keep the original failing ancestor-scroll operation as a direct
  // regression check, independently of the body-only reader controls below.
  await page.locator('.home-next-card').scrollIntoViewIfNeeded();
  await expectChromeStill();

  const expectInsideBody = async (target, move = true) => {
    if (move) {
      const outer = await bodyClipBounds();
      const inner = await target.boundingBox();
      const delta = inner.y < outer.y ? inner.y - outer.y
        : inner.y + inner.height > outer.y + outer.height
          ? inner.y + inner.height - outer.y - outer.height : 0;
      if (delta !== 0) {
        if (browserName === 'webkit' && isMobile) {
          await body.evaluate((element, amount) => { element.scrollTop += amount; }, delta);
        } else {
          await page.mouse.move(outer.x + outer.width / 2, outer.y + outer.height / 2);
          await page.mouse.wheel(0, delta);
        }
      }
    }
    await expect.poll(async () => {
      const outer = await bodyClipBounds();
      const inner = await target.boundingBox();
      return outer && inner && inner.y >= outer.y - 1
        && inner.y + inner.height <= outer.y + outer.height + 1
        && inner.x >= outer.x - 1 && inner.x + inner.width <= outer.x + outer.width + 1;
    }).toBe(true);
    await expectChromeStill();
    const outer = await body.boundingBox();
    expect(outer.y).toBeGreaterThanOrEqual(initialHeader.y + initialHeader.height - 1);
    expect(outer.y + outer.height).toBeLessThanOrEqual(initialNav.y + 1);
  };

  // Chromium proves the native wheel path above. Mobile WebKit has no wheel
  // API, so the checks below establish reader positions through DOM scrolling
  // and verify real layout/control behavior; they do not prove iOS gestures.
  for (const selector of ['.home-next-card', '.home-today-panel', '.home-alert-grid', '.home-progress-panel']) {
    await expectInsideBody(page.locator(selector));
  }
  const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
  await expectInsideBody(add);
  // Real keyboard navigation also invokes the browser's focus scrolling.
  // A clipped ancestor must stay still while focus reaches the add action.
  await header.locator('button').first().focus();
  const firstNavButton = nav.locator('button').first();
  let reachedAdd = false;
  let reachedFooter = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await add.evaluate(element => element === document.activeElement)) reachedAdd = true;
    await expectChromeStill();
    const focus = await body.evaluate(element => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !element.contains(active)) return { contained: true };
      const inner = active.getBoundingClientRect();
      const outer = element.getBoundingClientRect();
      const clipLeft = outer.left + element.clientLeft;
      const clipTop = outer.top + element.clientTop;
      const style = getComputedStyle(active);
      const outline = Math.max(0, (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0));
      return {
        name: active.getAttribute('aria-label') ?? active.textContent,
        contained: inner.top - outline >= clipTop - 1 && inner.bottom + outline <= clipTop + element.clientHeight + 1
          && inner.left - outline >= clipLeft - 1 && inner.right + outline <= clipLeft + element.clientWidth + 1,
      };
    });
    expect(focus.contained, JSON.stringify(focus)).toBe(true);
    if (await firstNavButton.evaluate(element => element === document.activeElement)) {
      reachedFooter = true;
      break;
    }
  }
  expect(reachedAdd).toBe(true);
  expect(reachedFooter).toBe(true);
  await add.focus();
  await expectChromeStill();
  await expect(add).toBeFocused();
  await expectInsideBody(add, false);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await add.click();
  const chooser = page.getByRole('dialog', { name: '今日の予定に追加', exact: true });
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(chooser).toBeHidden();
  await expectInsideBody(add);
}
