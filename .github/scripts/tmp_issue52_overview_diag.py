from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


hook_path = Path('src/hooks/useTimelineDragController.ts')
hook = hook_path.read_text()
hook = replace_once(
    hook,
    """  function handleTouchStart(
    event: ReactTouchEvent<HTMLElement>,
    descriptor: TimelineDragDescriptor<TItem>,
  ) {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    const session = createDragSession(
      'touch',
      descriptor,
      event.currentTarget,
      touch.clientX,
      touch.clientY,
    );""",
    """  function handleTouchStart(
    event: ReactTouchEvent<HTMLElement>,
    descriptor: TimelineDragDescriptor<TItem>,
    sourceElement?: HTMLElement,
  ) {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    const session = createDragSession(
      'touch',
      descriptor,
      sourceElement ?? event.currentTarget,
      touch.clientX,
      touch.clientY,
    );""",
    'drag controller delegated touch source',
)
hook_path.write_text(hook)


dialog_path = Path('src/components/AiPlanningPreviewDialog.tsx')
dialog = dialog_path.read_text()
dialog = replace_once(
    dialog,
    "import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';",
    "import {\n  useEffect,\n  useMemo,\n  useRef,\n  useState,\n  type CSSProperties,\n  type KeyboardEvent,\n  type TouchEvent as ReactTouchEvent,\n} from 'react';",
    'dialog React touch event import',
)
dialog = replace_once(
    dialog,
    "import { useTimelineDragController } from '../hooks/useTimelineDragController';",
    "import {\n  useTimelineDragController,\n  type TimelineDragDescriptor,\n} from '../hooks/useTimelineDragController';",
    'dialog drag descriptor import',
)
dialog = replace_once(
    dialog,
    "  const actionPressRef = useRef<PreviewActionPress | null>(null);\n  const moveHistory = useUndoRedoHistory<string, WeekPlanMoveTarget>();",
    "  const actionPressRef = useRef<PreviewActionPress | null>(null);\n  const overviewDelegatedTouchBlockIdRef = useRef<string | null>(null);\n  const moveHistory = useUndoRedoHistory<string, WeekPlanMoveTarget>();",
    'overview delegated touch ref',
)
dialog = replace_once(
    dialog,
    """  const dragController = useTimelineDragController<WeeklyPlanDraftBlock>({
    onCommit: (descriptor, before, after) => {
      applyBlockTarget(descriptor.item.id, after);
      moveHistory.record({
        key: descriptor.item.id,
        before,
        after,
      });
    },
    deferTouchDragUntilMoveAfterLongPress: true,
  });

  useEffect(() => {""",
    """  function buildOverviewDragDescriptor(
    block: WeeklyPlanDraftBlock,
  ): TimelineDragDescriptor<WeeklyPlanDraftBlock> | null {
    if (isBusy) return null;
    return {
      key: `overview:${block.id}`,
      item: block,
      title: block.title,
      toneClass: toneClass(block),
      original: {
        date: block.date,
        startTime: block.startTime,
        endTime: block.endTime,
      },
      dates: pageDates,
      allowDateChange: true,
      dayColumnSelector: '.ai-planning-preview-overview-day',
      scrollSelector: '.ai-planning-preview-overview-scroll',
    };
  }

  const dragController = useTimelineDragController<WeeklyPlanDraftBlock>({
    onCommit: (descriptor, before, after) => {
      applyBlockTarget(descriptor.item.id, after);
      moveHistory.record({
        key: descriptor.item.id,
        before,
        after,
      });
    },
    deferTouchDragUntilMoveAfterLongPress: true,
  });

  function resolveOverviewTouchBlock(clientX: number, clientY: number) {
    const hit = document.elementFromPoint(clientX, clientY);
    const element = hit?.closest<HTMLElement>('[data-ai-preview-action-block]') ?? null;
    if (!element || !element.closest('.ai-planning-preview-overview-body')) return null;

    const blockId = element.dataset.aiPreviewActionBlock;
    if (!blockId) return null;
    const block = editableBlocks.find(
      (candidate) => candidate.id === blockId && pageDates.includes(candidate.date),
    );
    if (!block) return null;
    return { block, element };
  }

  function handleOverviewTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return;
    const dispatchedTarget = event.target as HTMLElement;
    if (dispatchedTarget.closest?.('[data-ai-preview-action-block]')) return;

    const touch = event.touches[0];
    const resolved = resolveOverviewTouchBlock(touch.clientX, touch.clientY);
    if (!resolved) return;
    const descriptor = buildOverviewDragDescriptor(resolved.block);
    if (!descriptor) return;

    overviewDelegatedTouchBlockIdRef.current = resolved.block.id;
    startActionPress(
      resolved.block.id,
      'touch',
      touch.clientX,
      touch.clientY,
      true,
    );
    dragController.handleTouchStart(event, descriptor, resolved.element);
  }

  function handleOverviewTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    if (!overviewDelegatedTouchBlockIdRef.current) return;
    const touch = event.touches[0];
    if (touch) updateActionPress(touch.clientX, touch.clientY);
    dragController.handleTouchMove(event);
  }

  function handleOverviewTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const blockId = overviewDelegatedTouchBlockIdRef.current;
    if (!blockId) return;
    const shouldReveal = finishTouchActionPress(blockId);
    dragController.handleTouchEnd(event);
    overviewDelegatedTouchBlockIdRef.current = null;
    if (shouldReveal) setActiveActionBlockId(blockId);
  }

  function handleOverviewTouchCancel() {
    if (!overviewDelegatedTouchBlockIdRef.current) return;
    overviewDelegatedTouchBlockIdRef.current = null;
    clearActionPress();
    dragController.handleTouchCancel();
  }

  useEffect(() => {""",
    'overview delegated touch handlers',
)
dialog = replace_once(
    dialog,
    """    setSelectedDate('');
    setActiveActionBlockId(null);
    clearActionPress();""",
    """    setSelectedDate('');
    setActiveActionBlockId(null);
    overviewDelegatedTouchBlockIdRef.current = null;
    clearActionPress();""",
    'reset overview delegated touch state',
)
dialog = replace_once(
    dialog,
    """                  <div className=\"ai-planning-week-body ai-planning-preview-overview-body\" style={overviewGridStyle}>""",
    """                  <div
                    className=\"ai-planning-week-body ai-planning-preview-overview-body\"
                    style={overviewGridStyle}
                    onTouchStart={handleOverviewTouchStart}
                    onTouchMove={handleOverviewTouchMove}
                    onTouchEnd={handleOverviewTouchEnd}
                    onTouchCancel={handleOverviewTouchCancel}
                  >""",
    'overview body delegated touch listeners',
)
dialog = replace_once(
    dialog,
    """                          aria-label={`${formatDateLabel(group.date)}の予定を日別表示`}
                          onClick={() => openDay(group.date)}
                          onKeyDown={(event) => activateByKeyboard(event, () => openDay(group.date))}""",
    """                          aria-label={`${formatDateLabel(group.date)}の予定を日別表示`}
                          onClick={(event) => {
                            if (dragController.shouldSuppressClick()) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
                            openDay(group.date);
                          }}
                          onKeyDown={(event) => activateByKeyboard(event, () => openDay(group.date))}""",
    'overview day click suppression',
)
dialog = replace_once(
    dialog,
    """                            const dragDescriptor = !isBusy
                              ? {
                                  key: `overview:${block.id}`,
                                  item: block,
                                  title: block.title,
                                  toneClass: toneClass(block),
                                  original: {
                                    date: block.date,
                                    startTime: block.startTime,
                                    endTime: block.endTime,
                                  },
                                  dates: pageDates,
                                  allowDateChange: true,
                                  dayColumnSelector: '.ai-planning-preview-overview-day',
                                  scrollSelector: '.ai-planning-preview-overview-scroll',
                                }
                              : null;""",
    """                            const dragDescriptor = buildOverviewDragDescriptor(block);""",
    'overview drag descriptor helper',
)
for label, old in [
    (
        'overview child touch start',
        """                                onTouchStart={
                                  dragDescriptor
                                    ? (event) => {
                                        const touch = event.touches[0];
                                        if (touch) {
                                          startActionPress(
                                            block.id,
                                            'touch',
                                            touch.clientX,
                                            touch.clientY,
                                            true,
                                          );
                                        }
                                        dragController.handleTouchStart(event, dragDescriptor);
                                      }
                                    : undefined
                                }
""",
    ),
    (
        'overview child touch move',
        """                                onTouchMove={
                                  dragDescriptor
                                    ? (event) => {
                                        const touch = event.touches[0];
                                        if (touch) updateActionPress(touch.clientX, touch.clientY);
                                        dragController.handleTouchMove(event);
                                      }
                                    : undefined
                                }
""",
    ),
    (
        'overview child touch end',
        """                                onTouchEnd={
                                  dragDescriptor
                                    ? (event) => {
                                        const shouldReveal = finishTouchActionPress(block.id);
                                        dragController.handleTouchEnd(event);
                                        if (shouldReveal) setActiveActionBlockId(block.id);
                                      }
                                    : undefined
                                }
""",
    ),
    (
        'overview child touch cancel',
        """                                onTouchCancel={
                                  dragDescriptor
                                    ? () => {
                                        clearActionPress();
                                        dragController.handleTouchCancel();
                                      }
                                    : undefined
                                }
""",
    ),
]:
    dialog = replace_once(dialog, old, '', label)
dialog_path.write_text(dialog)


test_path = Path('tests/e2e/ai-planning-preview-item-removal.spec.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    """  const firstCenter = await locatorCenter(firstBlock);
  const session = await enableTouch(page);

  await expect(firstRemoveAction).toHaveCount(0);""",
    """  const session = await enableTouch(page);
  const firstCenter = await locatorCenter(firstBlock);

  await expect(firstRemoveAction).toHaveCount(0);""",
    'overview touch coordinate ordering',
)
test = replace_once(
    test,
    """  await expect(previewBlock(restoredPreview, '金フレ B', 'overview')).toBeVisible();

  await context.close();""",
    """  const restoredBlock = previewBlock(restoredPreview, '金フレ B', 'overview');
  await expect(restoredBlock).toBeVisible();
  await page.waitForTimeout(750);
  await restoredBlock.click();
  await expect(restoredPreview.getByRole('tab', { name: '日別' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await context.close();""",
    'overview normal tap navigation regression',
)
test_path.write_text(test)
