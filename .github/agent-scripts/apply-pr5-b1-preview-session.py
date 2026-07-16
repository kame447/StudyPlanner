from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRANCH = "agent/weekly-planning-conversation-hardening"


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{relative_path}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def write(relative_path: str, content: str) -> None:
    path = ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def commit(message: str, *paths: str) -> None:
    run("git", "add", *paths)
    run("git", "commit", "-m", message)
    run("git", "push", "origin", f"HEAD:{BRANCH}")


# PlanningState owns unsaved preview candidates.
replace_once(
    "src/features/weeklyPlanning/types.ts",
    "import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';\n",
    "import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';\n"
    "import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';\n",
)
replace_once(
    "src/features/weeklyPlanning/types.ts",
    "  draftBlocks: WeeklyPlanDraftBlock[];\n  messages: WeeklyPlanningMessage[];\n",
    "  draftBlocks: WeeklyPlanDraftBlock[];\n"
    "  previewCandidates?: WeeklyDraftCandidate[];\n"
    "  messages: WeeklyPlanningMessage[];\n",
)
replace_once(
    "src/features/weeklyPlanning/types.ts",
    "  | { type: 'clear_draft_blocks' }\n",
    "  | { type: 'clear_draft_blocks' }\n"
    "  | { type: 'remove_preview_candidate'; candidateId: string }\n",
)
replace_once(
    "src/features/weeklyPlanning/types.ts",
    "      intakeState: PlanningIntakeState;\n      assistantMessage: WeeklyPlanningMessage;\n",
    "      intakeState: PlanningIntakeState;\n"
    "      assistantMessage: WeeklyPlanningMessage;\n"
    "      draftCandidates?: WeeklyDraftCandidate[];\n",
)

replace_once(
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "    draftBlocks: [],\n    messages: [],\n",
    "    draftBlocks: [],\n    previewCandidates: [],\n    messages: [],\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "        ...appendAssistantMessage(state, action.assistantMessage),\n        intakeState: action.intakeState,\n        pendingTurn: undefined,\n",
    "        ...appendAssistantMessage(state, action.assistantMessage),\n"
    "        mode: (action.draftCandidates?.length ?? 0) > 0 ? 'draft_created' : state.mode,\n"
    "        intakeState: action.intakeState,\n"
    "        previewCandidates: action.draftCandidates ?? [],\n"
    "        pendingTurn: undefined,\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "        mode: 'awaiting_approval',\n        draftBlocks: [...getPendingDraftBlocks(state.draftBlocks), ...action.blocks],\n",
    "        mode: 'awaiting_approval',\n"
    "        draftBlocks: [...getPendingDraftBlocks(state.draftBlocks), ...action.blocks],\n"
    "        previewCandidates: [],\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "    case 'clear_draft_blocks':\n      if (state.draftBlocks.length === 0) return state;\n      return withMutation(state, {\n        ...state,\n        draftBlocks: [],\n        mode: 'idle',\n      });\n",
    "    case 'remove_preview_candidate': {\n"
    "      const currentCandidates = state.previewCandidates ?? [];\n"
    "      const nextCandidates = currentCandidates.filter(\n"
    "        (candidate) => candidate.stableKey !== action.candidateId,\n"
    "      );\n"
    "      if (nextCandidates.length === currentCandidates.length) return state;\n"
    "      return withMutation(state, {\n"
    "        ...state,\n"
    "        previewCandidates: nextCandidates,\n"
    "        mode: nextCandidates.length > 0\n"
    "          ? 'draft_created'\n"
    "          : state.draftBlocks.length > 0\n"
    "            ? 'awaiting_approval'\n"
    "            : state.messages.length > 0 || state.intakeState\n"
    "              ? 'collecting_tasks'\n"
    "              : 'idle',\n"
    "      });\n"
    "    }\n\n"
    "    case 'clear_draft_blocks':\n"
    "      if (state.draftBlocks.length === 0 && (state.previewCandidates?.length ?? 0) === 0) {\n"
    "        return state;\n"
    "      }\n"
    "      return withMutation(state, {\n"
    "        ...state,\n"
    "        draftBlocks: [],\n"
    "        previewCandidates: [],\n"
    "        mode: state.messages.length > 0 || state.intakeState ? 'collecting_tasks' : 'idle',\n"
    "      });\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "        mode: state.draftBlocks.length > 0 ? 'awaiting_approval' : 'idle',\n        messages: [],\n",
    "        mode: state.draftBlocks.length > 0\n"
    "          ? 'awaiting_approval'\n"
    "          : (state.previewCandidates?.length ?? 0) > 0\n"
    "            ? 'draft_created'\n"
    "            : 'idle',\n"
    "        messages: [],\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "        draftBlocks: [],\n        messages: [],\n        intakeState: undefined,\n",
    "        draftBlocks: [],\n"
    "        previewCandidates: [],\n"
    "        messages: [],\n"
    "        intakeState: undefined,\n",
)

# Turn completion atomically commits the generated candidates.
replace_once(
    "src/App.tsx",
    "        intakeState: result.state,\n        assistantMessage,\n",
    "        intakeState: result.state,\n"
    "        assistantMessage,\n"
    "        draftCandidates: result.draftCandidates,\n",
)
replace_once(
    "src/App.tsx",
    "             weeklyDraftBlocks={pendingWeeklyDraftBlocks}\n             weeklyPlanningMessages={planningState.messages}\n",
    "             weeklyDraftBlocks={pendingWeeklyDraftBlocks}\n"
    "             weeklyPlanningPreviewCandidates={planningState.previewCandidates ?? []}\n"
    "             weeklyPlanningMessages={planningState.messages}\n",
)
replace_once(
    "src/App.tsx",
    "               onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}\n             onRemoveWeeklyDraftBlock={(blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}\n",
    "               onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}\n"
    "             onRemoveWeeklyPlanningPreviewCandidate={(candidateId) =>\n"
    "               dispatchPlanningAction({ type: 'remove_preview_candidate', candidateId })\n"
    "             }\n"
    "             onRemoveWeeklyDraftBlock={(blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}\n",
)

# QuickEntry passes session-owned preview through to the assistant.
replace_once(
    "src/components/QuickEntryModal.tsx",
    "import type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\n",
    "import type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\n"
    "import type { WeeklyDraftCandidate } from '../features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator';\n",
)
replace_once(
    "src/components/QuickEntryModal.tsx",
    "  weeklyDraftBlocks: WeeklyPlanDraftBlock[];\n  weeklyPlanningMessages: WeeklyPlanningMessage[];\n",
    "  weeklyDraftBlocks: WeeklyPlanDraftBlock[];\n"
    "  weeklyPlanningPreviewCandidates?: WeeklyDraftCandidate[];\n"
    "  weeklyPlanningMessages: WeeklyPlanningMessage[];\n",
)
replace_once(
    "src/components/QuickEntryModal.tsx",
    "  onCreateWeeklyDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => void;\n  onRemoveWeeklyDraftBlock: (blockId: string) => void;\n",
    "  onCreateWeeklyDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => void;\n"
    "  onRemoveWeeklyPlanningPreviewCandidate?: (candidateId: string) => void;\n"
    "  onRemoveWeeklyDraftBlock: (blockId: string) => void;\n",
)
replace_once(
    "src/components/QuickEntryModal.tsx",
    "  weeklyDraftBlocks,\n  weeklyPlanningMessages,\n",
    "  weeklyDraftBlocks,\n"
    "  weeklyPlanningPreviewCandidates = [],\n"
    "  weeklyPlanningMessages,\n",
)
replace_once(
    "src/components/QuickEntryModal.tsx",
    "  onCreateWeeklyDraftBlocks,\n  onRemoveWeeklyDraftBlock,\n",
    "  onCreateWeeklyDraftBlocks,\n"
    "  onRemoveWeeklyPlanningPreviewCandidate,\n"
    "  onRemoveWeeklyDraftBlock,\n",
)
replace_once(
    "src/components/QuickEntryModal.tsx",
    "                 weeklyDraftBlocks={weeklyDraftBlocks}\n                 weeklyPlanningMessages={weeklyPlanningMessages}\n",
    "                 weeklyDraftBlocks={weeklyDraftBlocks}\n"
    "                 weeklyPlanningPreviewCandidates={weeklyPlanningPreviewCandidates}\n"
    "                 weeklyPlanningMessages={weeklyPlanningMessages}\n",
)
replace_once(
    "src/components/QuickEntryModal.tsx",
    "                  onCreateWeeklyDraftBlocks={onCreateWeeklyDraftBlocks}\n                 onRemoveWeeklyDraftBlock={onRemoveWeeklyDraftBlock}\n",
    "                  onCreateWeeklyDraftBlocks={onCreateWeeklyDraftBlocks}\n"
    "                 onRemoveWeeklyPlanningPreviewCandidate={onRemoveWeeklyPlanningPreviewCandidate}\n"
    "                 onRemoveWeeklyDraftBlock={onRemoveWeeklyDraftBlock}\n",
)

# NaturalLanguageAssistant becomes a view/controller over session state.
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  createWeeklyPlanningPreviewDisplayBlock,\n  removeWeeklyPlanningPreviewBlock,\n  type WeeklyPlanningPreviewBlock,\n",
    "  createWeeklyPlanningPreviewDisplayBlock,\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  weeklyDraftBlocks: WeeklyPlanDraftBlock[];\n  weeklyPlanningMessages: WeeklyPlanningMessage[];\n",
    "  weeklyDraftBlocks: WeeklyPlanDraftBlock[];\n"
    "  weeklyPlanningPreviewCandidates?: WeeklyDraftCandidate[];\n"
    "  weeklyPlanningMessages: WeeklyPlanningMessage[];\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;\n  onRemoveWeeklyDraftBlock?: (blockId: string) => void;\n",
    "  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;\n"
    "  onRemoveWeeklyPlanningPreviewCandidate?: (candidateId: string) => void;\n"
    "  onRemoveWeeklyDraftBlock?: (blockId: string) => void;\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  weeklyDraftBlocks,\n  weeklyPlanningMessages,\n",
    "  weeklyDraftBlocks,\n"
    "  weeklyPlanningPreviewCandidates = [],\n"
    "  weeklyPlanningMessages,\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  onCreateWeeklyDraftBlocks,\n  onRemoveWeeklyDraftBlock,\n",
    "  onCreateWeeklyDraftBlocks,\n"
    "  onRemoveWeeklyPlanningPreviewCandidate,\n"
    "  onRemoveWeeklyDraftBlock,\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  const [weeklyPlanningPreviewBlocks, setWeeklyPlanningPreviewBlocks] = useState<\n    WeeklyPlanningPreviewBlock[]\n  >([]);\n  const [weeklyPlanningPreviewCandidates, setWeeklyPlanningPreviewCandidates] =\n    useState<WeeklyDraftCandidate[]>([]);\n",
    "",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  const localWeeklyPlanningPreviewDraftBlocks = weeklyPlanningPreviewBlocks.map(\n",
    "  const weeklyPlanningPreviewBlocks = createWeeklyPlanningPreviewBlocks(\n"
    "    weeklyPlanningPreviewCandidates,\n"
    "  );\n"
    "  const localWeeklyPlanningPreviewDraftBlocks = weeklyPlanningPreviewBlocks.map(\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "    setWeeklyPlanningPreviewBlocks([]);\n    setWeeklyPlanningPreviewCandidates([]);\n",
    "",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "    setWeeklyPlanningPreviewBlocks([]);\n    setWeeklyPlanningPreviewCandidates([]);\n",
    "",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "  function removeLocalWeeklyPlanningPreviewBlock(blockId: string) {\n    const nextPreview = removeWeeklyPlanningPreviewBlock({\n      previewBlocks: weeklyPlanningPreviewBlocks,\n      candidates: weeklyPlanningPreviewCandidates,\n      blockId,\n    });\n    const nextDates = Array.from(\n      new Set(nextPreview.previewBlocks.map((block) => block.date)),\n    ).sort();\n\n    setWeeklyPlanningPreviewBlocks(nextPreview.previewBlocks);\n    setWeeklyPlanningPreviewCandidates(nextPreview.candidates);\n    if (nextPreview.previewBlocks.length === 0) {\n      setSelectedWeeklyDraftDate('');\n      setWeeklyDraftPreviewMode('overview');\n    } else if (!nextDates.includes(selectedWeeklyDraftDate)) {\n      setSelectedWeeklyDraftDate(nextDates[0] ?? '');\n    }\n  }\n",
    "  function removeLocalWeeklyPlanningPreviewBlock(blockId: string) {\n"
    "    onRemoveWeeklyPlanningPreviewCandidate?.(blockId);\n"
    "    const nextBlocks = weeklyPlanningPreviewBlocks.filter((block) => block.id !== blockId);\n"
    "    const nextDates = Array.from(new Set(nextBlocks.map((block) => block.date))).sort();\n\n"
    "    if (nextBlocks.length === 0) {\n"
    "      setSelectedWeeklyDraftDate('');\n"
    "      setWeeklyDraftPreviewMode('overview');\n"
    "    } else if (!nextDates.includes(selectedWeeklyDraftDate)) {\n"
    "      setSelectedWeeklyDraftDate(nextDates[0] ?? '');\n"
    "    }\n"
    "  }\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "      const nextPreviewBlocks = createWeeklyPlanningPreviewBlocks(result.draftCandidates);\n      setWeeklyPlanningPreviewCandidates(result.draftCandidates);\n      setWeeklyPlanningPreviewBlocks(nextPreviewBlocks);\n      if (nextPreviewBlocks.length > 0) {\n",
    "      if (result.draftCandidates.length > 0) {\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "    onCreateWeeklyDraftBlocks(blocks);\n    setWeeklyPlanningPreviewCandidates([]);\n    setWeeklyPlanningPreviewBlocks([]);\n",
    "    onCreateWeeklyDraftBlocks(blocks);\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "            setAiInputMode('chat');\n            setWeeklyPlanningPreviewBlocks([]);\n            setWeeklyPlanningPreviewCandidates([]);\n",
    "            setAiInputMode('chat');\n",
)
replace_once(
    "src/components/NaturalLanguageAssistant.tsx",
    "            setEditTargetPlanId('');\n            setWeeklyPlanningPreviewBlocks([]);\n            setWeeklyPlanningPreviewCandidates([]);\n            setSelectedWeeklyDraftDate('');\n",
    "            setEditTargetPlanId('');\n"
    "            setSelectedWeeklyDraftDate('');\n",
)

# Persist and restore preview candidates. Deep validation is completed in the M1/M2 stage.
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningStorage.ts",
    "    && Array.isArray(value.draftBlocks)\n    && value.draftBlocks.every(isDraftBlock)\n    && Array.isArray(value.messages)\n",
    "    && Array.isArray(value.draftBlocks)\n"
    "    && value.draftBlocks.every(isDraftBlock)\n"
    "    && (value.previewCandidates === undefined || Array.isArray(value.previewCandidates))\n"
    "    && Array.isArray(value.messages)\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningStorage.ts",
    "       pendingApproval: undefined,\n       draftBlocks: storedState.draftBlocks.filter((block) => block.status === 'draft'),\n",
    "       pendingApproval: undefined,\n"
    "       draftBlocks: storedState.draftBlocks.filter((block) => block.status === 'draft'),\n"
    "       previewCandidates: storedState.previewCandidates ?? [],\n",
)
replace_once(
    "src/features/weeklyPlanning/weeklyPlanningStorage.ts",
    "       serializableState.draftBlocks.length === 0\n       && serializableState.messages.length === 0\n",
    "       serializableState.draftBlocks.length === 0\n"
    "       && (serializableState.previewCandidates?.length ?? 0) === 0\n"
    "       && serializableState.messages.length === 0\n",
)

write(
    "src/features/weeklyPlanning/weeklyPlanningPreviewSessionLifecycle.test.tsx",
    """import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NaturalLanguageAssistant } from '../../components/NaturalLanguageAssistant';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import { loadWeeklyPlanningState, saveWeeklyPlanningState } from './weeklyPlanningStorage';

const storedValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => { storedValues.set(key, value); },
  removeItem: (key: string) => { storedValues.delete(key); },
  clear: () => { storedValues.clear(); },
  key: (index: number) => Array.from(storedValues.keys())[index] ?? null,
  get length() { return storedValues.size; },
} as Storage;

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: localStorageMock },
});

const NOW = '2026-07-16T00:00:00.000Z';
const WEEK_START = '2026-07-13';

function previewCandidate(): WeeklyDraftCandidate {
  return {
    stableKey: 'preview-english-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    title: '英語ワーク',
    field: '英語',
    year: 1,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: '英語:1',
  };
}

describe('weekly planning preview session lifecycle', () => {
  beforeEach(() => storedValues.clear());

  it('restores a preview committed after the modal was unmounted', () => {
    const initial = createInitialPlanningState(WEEK_START);
    const pending = {
      requestId: 'turn-1',
      weekStartDate: WEEK_START,
      baseRevision: initial.revision,
      startedAt: NOW,
    };
    const begun = weeklyPlanningReducer(initial, {
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'user-1',
        role: 'user',
        content: 'この条件で作成',
        createdAt: NOW,
      },
    });

    // No component is mounted while this asynchronous result is committed.
    const committed = weeklyPlanningReducer(begun, {
      type: 'commit_turn',
      pending,
      intakeState: createInitialPlanningIntakeState(),
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '仮予定を作成します。',
        createdAt: NOW,
      },
      draftCandidates: [previewCandidate()],
    });
    saveWeeklyPlanningState('user-1', committed);

    const reopened = loadWeeklyPlanningState('user-1', WEEK_START);
    expect(reopened.previewCandidates).toEqual([previewCandidate()]);

    const html = renderToStaticMarkup(
      <NaturalLanguageAssistant
        selectedDate="2026-07-16"
        userId="user-1"
        plans={[]}
        onApplyDraft={vi.fn(async () => undefined)}
        weeklyDraftBlocks={[]}
        weeklyPlanningPreviewCandidates={reopened.previewCandidates}
        weeklyPlanningMessages={reopened.messages}
        weeklyPlanningIntakeState={reopened.intakeState ?? null}
        weeklyPlanningWeekStartDate={reopened.weekStartDate}
        weeklyPlanningRevision={reopened.revision}
        onSubmitWeeklyPlanningTurn={vi.fn(async () => ({ accepted: true, draftCandidates: [] }))}
        onAppendWeeklyPlanningMessage={vi.fn()}
        onResetWeeklyPlanningSession={vi.fn()}
        onCreateWeeklyDraftBlocks={vi.fn()}
        onRemoveWeeklyPlanningPreviewCandidate={vi.fn()}
        embedded
      />,
    );

    expect(html).toContain('英語ワーク');
    expect(html).toContain('この内容で仮予定にする');
  });
});
""",
)

run(
    "npm", "run", "test:run", "--",
    "src/features/weeklyPlanning/weeklyPlanningPreviewSessionLifecycle.test.tsx",
    "src/components/QuickEntryModalSessionResume.test.tsx",
    "src/features/weeklyPlanning/weeklyPlanningConversationPersistence.test.ts",
)
run("npm", "run", "build")
commit(
    "feat: 週間計画previewをsession所有に移行",
    "src/App.tsx",
    "src/components/NaturalLanguageAssistant.tsx",
    "src/components/QuickEntryModal.tsx",
    "src/features/weeklyPlanning/types.ts",
    "src/features/weeklyPlanning/weeklyPlanningReducer.ts",
    "src/features/weeklyPlanning/weeklyPlanningStorage.ts",
    "src/features/weeklyPlanning/weeklyPlanningPreviewSessionLifecycle.test.tsx",
)

replace_once(
    "docs/ai/tasks/20260716-weekly-planning-pr5-rereview-fixes.md",
    "1. B1 preview lifecycle\n",
    "1. B1 preview lifecycle（完了）\n",
)
run("git", "rm", ".github/agent-scripts/apply-pr5-b1-preview-session.py")
run("git", "rm", ".github/workflows/apply-pr5-b1-preview-session.yml")
commit(
    "feat: PR5再レビューB1修正を記録",
    "docs/ai/tasks/20260716-weekly-planning-pr5-rereview-fixes.md",
    ".github/agent-scripts/apply-pr5-b1-preview-session.py",
    ".github/workflows/apply-pr5-b1-preview-session.yml",
)
