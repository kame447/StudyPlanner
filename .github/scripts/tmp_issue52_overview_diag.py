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
                        >""",
    'overview body column interaction',
)
dialog = replace_once(
    dialog,
    '予定を長押しすると下の操作バーから除外できます。長押ししたまま動かすと日時を調整できます。日付をタップすると日別表示します。',
    '予定を長押しすると下の操作バーから除外できます。長押ししたまま動かすと日時を調整できます。上の日付をタップすると日別表示します。',
    'overview navigation hint',
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
}""",
    """.ai-planning-preview-dialog-v2 .ai-planning-preview-overview-day {
  overflow: hidden;
  cursor: default;
  outline: 0;
  pointer-events: none;
}""",
    'overview body hit target',
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
    const day = hit?.closest?.('.ai-planning-preview-overview-day');
    return {
      x,
      y,
      hitTag: hit?.tagName ?? null,
      hitClass: hit?.getAttribute?.('class') ?? null,
      blockId: block?.getAttribute('data-ai-preview-action-block') ?? null,
      blockPointerEvents: block ? getComputedStyle(block).pointerEvents : null,
      dayPointerEvents: day ? getComputedStyle(day).pointerEvents : null,
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
