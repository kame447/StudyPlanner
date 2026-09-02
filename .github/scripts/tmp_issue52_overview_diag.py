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

  await expect(firstRemoveAction).toHaveCount(0);""",
    """  const session = await enableTouch(page);
  const firstCenter = await locatorCenter(firstBlock);

  await expect(firstBlock).toHaveCSS('pointer-events', 'auto');
  await expect(firstRemoveAction).toHaveCount(0);""",
    'overview touch coordinate ordering',
)
test_path.write_text(test)
