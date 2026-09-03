from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


test_path = Path('tests/e2e/ai-planning-preview-item-removal.spec.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    """  const preview = await openPreview(page, 2, { mode: 'overview' });
  const firstBlock = previewBlock(preview, '金フレ A', 'overview');""",
    """  const preview = await openPreview(page, 2, { mode: 'overview' });
  await preview.evaluate(async (element) => {
    const animations = element.getAnimations();
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
  const firstBlock = previewBlock(preview, '金フレ A', 'overview');""",
    'wait for preview entrance animation before touch coordinates',
)
test_path.write_text(test)
