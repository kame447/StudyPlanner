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
    """    const dispatchedTarget = event.target as HTMLElement;
    if (dispatchedTarget.closest?.('[data-ai-preview-action-block]')) return;

""",
    "",
    'delegate every overview touch through coordinate hit testing',
)
dialog = replace_once(
    dialog,
    """    const touch = event.touches[0];
    const resolved = resolveOverviewTouchBlock(touch.clientX, touch.clientY);
    if (!resolved) return;
    const descriptor = buildOverviewDragDescriptor(resolved.block);
    if (!descriptor) return;
""",
    """    const touch = event.touches[0];
    const hit = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    console.info(
      '[issue52-overview-touch] start',
      JSON.stringify({
        targetTag: (event.target as HTMLElement | null)?.tagName ?? null,
        targetClass: (event.target as HTMLElement | null)?.className ?? null,
        clientX: touch.clientX,
        clientY: touch.clientY,
        hitTag: hit?.tagName ?? null,
        hitClass: hit?.className ?? null,
        hitBlockId: hit?.closest<HTMLElement>('[data-ai-preview-action-block]')?.dataset.aiPreviewActionBlock ?? null,
      }),
    );
    const resolved = resolveOverviewTouchBlock(touch.clientX, touch.clientY);
    console.info(
      '[issue52-overview-touch] resolved',
      JSON.stringify({ blockId: resolved?.block.id ?? null }),
    );
    if (!resolved) return;
    const descriptor = buildOverviewDragDescriptor(resolved.block);
    console.info(
      '[issue52-overview-touch] descriptor',
      JSON.stringify({ blockId: resolved.block.id, available: Boolean(descriptor) }),
    );
    if (!descriptor) return;
""",
    'overview touch coordinate diagnostics',
)
dialog = replace_once(
    dialog,
    """    press.timerId = window.setTimeout(() => {
      if (actionPressRef.current !== press || press.moved) return;
      setActiveActionBlockId(blockId);
    }, PREVIEW_ACTION_LONG_PRESS_MS);""",
    """    press.timerId = window.setTimeout(() => {
      console.info(
        '[issue52-overview-touch] action-timer',
        JSON.stringify({
          blockId,
          currentBlockId: actionPressRef.current?.blockId ?? null,
          moved: press.moved,
          isCurrent: actionPressRef.current === press,
        }),
      );
      if (actionPressRef.current !== press || press.moved) return;
      setActiveActionBlockId(blockId);
      console.info(
        '[issue52-overview-touch] action-revealed',
        JSON.stringify({ blockId }),
      );
    }, PREVIEW_ACTION_LONG_PRESS_MS);""",
    'long press timer diagnostics',
)
dialog_path.write_text(dialog)


test_path = Path('tests/e2e/ai-planning-preview-item-removal.spec.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    """  const page = await context.newPage();
  await seedPreviewRemovalState(page, { phase: 'preview' });
  const preview = await openPreview(page, 2, { mode: 'overview' });""",
    """  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.text().startsWith('[issue52-overview-touch]')) {
      console.log(message.text());
    }
  });
  await seedPreviewRemovalState(page, { phase: 'preview' });
  const preview = await openPreview(page, 2, { mode: 'overview' });""",
    'surface overview browser diagnostics in CI log',
)
test_path.write_text(test)
