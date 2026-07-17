from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count == 0 and new in text:
        return
    if count != 1:
        raise RuntimeError(
            f'{path}: expected one match, found {count}: {old[:120]!r}'
        )
    file.write_text(text.replace(old, new))


storage = 'src/features/weeklyPlanning/weeklyPlanningStorage.ts'
replace_once(
    storage,
    "  WeeklyPlanningBehaviorMetadata,\n  WeeklyPlanningMessage,\n} from './types';",
    "  WeeklyPlanningBehaviorMetadata,\n  WeeklyPlanningMessage,\n  WeeklyPlanningReasoningKey,\n} from './types';",
)
replace_once(
    storage,
    "function isBehaviorMetadata(value: unknown): value is WeeklyPlanningBehaviorMetadata {",
    "function isReasoningKey(value: unknown): value is WeeklyPlanningReasoningKey {\n  return value === 'explicit-duration'\n    || value === 'explicit-unit-rate'\n    || value === 'accepted-assumption-duration';\n}\n\nfunction isBehaviorMetadata(value: unknown): value is WeeklyPlanningBehaviorMetadata {",
)
replace_once(
    storage,
    "    && typeof value.reasoningKey === 'string'\n    && value.compatibility.workItemSemantic === 'behavior_aware_task'",
    "    && isReasoningKey(value.reasoningKey)\n    && value.compatibility.workItemSemantic === 'behavior_aware_task'",
)
replace_once(
    storage,
    "    && (value.reasoningKey === 'explicit-duration'\n      || value.reasoningKey === 'explicit-unit-rate'\n      || value.reasoningKey === 'accepted-assumption-duration');",
    "    && isReasoningKey(value.reasoningKey);",
)

test = 'src/features/weeklyPlanning/weeklyPlanningStorageValidation.test.ts'
marker = """  it('round-trips a valid behavior-aware preview with its conversation and intake state', () => {
"""
new_test = """  it('rejects a promoted draft with an unknown reasoning key', () => {
    const candidate = behaviorAwarePreviewCandidate();
    storeV2({
      ...createInitialPlanningState(WEEK_START),
      revision: 11,
      mode: 'awaiting_approval',
      draftBlocks: [{
        ...validDraftBlock(),
        behaviorMetadata: {
          ...candidate.behaviorMetadata,
          reasoningKey: 'not_a_reasoning_key',
          compatibility: {
            workItemSemantic: 'behavior_aware_task',
            schedulerInputSource: 'exam_prep_request',
            candidateSource: 'weekly_exam_prep',
          },
        },
      }],
    });

    expectRejectedSession();
  });

""" + marker
replace_once(test, marker, new_test)
