from pathlib import Path

path = Path('tests/e2e/ai-planning-preview-item-removal.spec.mjs')
text = path.read_text()
old = """  const firstCenter = await locatorCenter(firstBlock);
  const session = await enableTouch(page);

  await expect(firstRemoveAction).toHaveCount(0);
  await dispatchTouch(session, 'touchStart', firstCenter.x, firstCenter.y);
  await page.waitForTimeout(300);
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(firstRemoveAction).toBeVisible();"""
new = """  const session = await enableTouch(page);
  const firstCenter = await locatorCenter(firstBlock);

  await page.evaluate(() => {
    window.__overviewTouchEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      document.addEventListener(type, (event) => {
        const target = event.target;
        const actionBlock = target?.closest?.('[data-ai-preview-action-block]');
        window.__overviewTouchEvents.push({
          type,
          targetTag: target?.tagName ?? null,
          targetClass: target?.getAttribute?.('class') ?? null,
          actionBlockId: actionBlock?.getAttribute('data-ai-preview-action-block') ?? null,
          time: Math.round(performance.now()),
        });
      }, true);
    }
  });
  console.log('OVERVIEW_HIT_BEFORE', await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const actionBlock = hit?.closest?.('[data-ai-preview-action-block]');
    return {
      hitTag: hit?.tagName ?? null,
      hitClass: hit?.getAttribute?.('class') ?? null,
      hitText: hit?.textContent ?? null,
      actionBlockId: actionBlock?.getAttribute('data-ai-preview-action-block') ?? null,
      actionBlockClass: actionBlock?.getAttribute('class') ?? null,
    };
  }, firstCenter));
  await expect(firstRemoveAction).toHaveCount(0);
  await dispatchTouch(session, 'touchStart', firstCenter.x, firstCenter.y);
  await page.waitForTimeout(300);
  console.log('OVERVIEW_TOUCH_EVENTS', await page.evaluate(() => window.__overviewTouchEvents));
  console.log('OVERVIEW_STATE_AFTER_HOLD', await firstBlock.evaluate((element) => ({
    className: element.className,
    pointerEvents: getComputedStyle(element).pointerEvents,
    touchAction: getComputedStyle(element).touchAction,
    actionBlockId: element.getAttribute('data-ai-preview-action-block'),
  })));
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(firstRemoveAction).toBeVisible();"""
if text.count(old) != 1:
    raise SystemExit(f'overview diagnostic insertion expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
