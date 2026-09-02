from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


dialog_path = Path('src/components/AiPlanningPreviewDialog.tsx')
dialog = dialog_path.read_text()
dialog = replace_once(
    dialog,
    """                        <div
                          className=\"ai-planning-day-column ai-planning-preview-overview-day\"
                          key={group.date}
                          role=\"button\"
                          tabIndex={0}
                          aria-label={`${formatDateLabel(group.date)}の予定を日別表示`}
                          onClick={() => openDay(group.date)}
                          onKeyDown={(event) => activateByKeyboard(event, () => openDay(group.date))}
                        >""",
    """                        <div
                          className=\"ai-planning-day-column ai-planning-preview-overview-day\"
                          key={group.date}
                        >
                          <button
                            type=\"button\"
                            className=\"ai-planning-preview-overview-day-hit-target\"
                            aria-label={`${formatDateLabel(group.date)}の予定を日別表示`}
                            onClick={() => openDay(group.date)}
                          />""",
    'overview day background target',
)
overview_marker = "const dragDescriptor = !isBusy\n                              ? {\n                                  key: `overview:${block.id}`"
overview_start = dialog.index(overview_marker)
open_tag = dialog.index('<div\n', overview_start)
dialog = dialog[:open_tag] + '<button\n                                type="button"\n' + dialog[open_tag + len('<div\n'):]
close_tag = dialog.index('</div>', open_tag)
dialog = dialog[:close_tag] + '</button>' + dialog[close_tag + len('</div>'):]
dialog_path.write_text(dialog)

css_path = Path('src/components/AiPlanningPreviewDialog.css')
css = css_path.read_text()
css = replace_once(
    css,
    """.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day {
  overflow: hidden;
  cursor: pointer;
  outline: 0;
}

.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day:focus-visible,
.ai-planning-preview-dialog-v2 .ai-planning-week-header > div:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(8, 120, 249, 0.32);
}""",
    """.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day {
  overflow: hidden;
  cursor: default;
  outline: 0;
}

.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day-hit-target {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day > .ai-planning-hour-line,
.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day > .ai-planning-existing-block {
  pointer-events: none;
}

.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day-hit-target:focus-visible,
.ai-planning-preview-dialog-v2 .ai-planning-week-header > div:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(8, 120, 249, 0.32);
}""",
    'overview explicit hit target styles',
)
css_path.write_text(css)

test_path = Path('tests/e2e/ai-planning-preview-item-removal.spec.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    """  const firstCenter = await locatorCenter(firstBlock);
  const session = await enableTouch(page);

  await expect(firstRemoveAction).toHaveCount(0);
  await dispatchTouch(session, 'touchStart', firstCenter.x, firstCenter.y);
  await page.waitForTimeout(300);
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(firstRemoveAction).toBeVisible();""",
    """  const session = await enableTouch(page);
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
  console.log('OVERVIEW_GEOMETRY', await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const block = hit?.closest?.('[data-ai-preview-action-block]');
    return {
      x,
      y,
      hitTag: hit?.tagName ?? null,
      hitClass: hit?.getAttribute?.('class') ?? null,
      blockId: block?.getAttribute('data-ai-preview-action-block') ?? null,
      blockPointerEvents: block ? getComputedStyle(block).pointerEvents : null,
      blockRect: block ? block.getBoundingClientRect().toJSON() : null,
    };
  }, firstCenter));
  await expect(firstBlock).toHaveJSProperty('tagName', 'BUTTON');
  await expect(firstBlock).toHaveCSS('pointer-events', 'auto');
  await expect(firstRemoveAction).toHaveCount(0);
  await dispatchTouch(session, 'touchStart', firstCenter.x, firstCenter.y);
  await page.waitForTimeout(300);
  console.log('OVERVIEW_TOUCH_EVENTS', await page.evaluate(() => window.__overviewTouchEvents));
  console.log('OVERVIEW_BLOCK_STATE', await firstBlock.evaluate((element) => ({
    tagName: element.tagName,
    className: element.className,
    pointerEvents: getComputedStyle(element).pointerEvents,
    touchAction: getComputedStyle(element).touchAction,
  })));
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(firstRemoveAction).toBeVisible();""",
    'overview native touch target trace',
)
test_path.write_text(test)
