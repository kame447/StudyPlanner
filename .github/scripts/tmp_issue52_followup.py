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
dialog_path.write_text(dialog)


test_path = Path('tests/e2e/ai-planning-preview-item-removal.spec.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    """  await remainingDraft.click();
  await expect(restoredPreview).toBeHidden();

  await page.goto('/');""",
    """  await remainingDraft.click();
  await expect(restoredPreview).toBeHidden();

  const persistedAfterLastDraftRemoval = await page.evaluate(() => {
    const stateEntry = Object.entries(localStorage).find(
      ([key]) =>
        key.startsWith('studyplanner.weeklyPlanning.') &&
        !key.includes('.activeSession.'),
    );
    if (!stateEntry) return null;
    const parsed = JSON.parse(stateEntry[1]);
    return parsed?.payload?.state ?? parsed?.state ?? null;
  });
  expect(persistedAfterLastDraftRemoval).not.toBeNull();
  expect(persistedAfterLastDraftRemoval.draftBlocks ?? []).toHaveLength(0);
  expect(persistedAfterLastDraftRemoval.previewCandidates ?? []).toHaveLength(0);

  await page.goto('/');""",
    'verify promoted last removal is persisted before reload',
)
test_path.write_text(test)
