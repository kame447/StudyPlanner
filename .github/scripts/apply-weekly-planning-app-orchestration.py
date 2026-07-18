from pathlib import Path
import re


APP = Path('src/App.tsx')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} anchors, found {count}')
    return text.replace(old, new)


def replace_pattern(text: str, pattern: str, replacement: str, label: str) -> str:
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return next_text


text = APP.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';",
    "import { Suspense, lazy, useMemo, useState } from 'react';",
    'react imports',
)
text = replace_pattern(
    text,
    r"import \{\n  createWeeklyDraftApprovalOperation,.*?import \{ createPlanDraftFromWeeklyDraftBlock \} from './features/weeklyPlanning/weeklyPlanningTransforms';\n",
    "import { useWeeklyPlanningApplication } from './features/weeklyPlanning/application/useWeeklyPlanningApplication';\n",
    'weekly planning implementation imports',
)
text = replace_pattern(
    text,
    r"const WEEKLY_APPROVAL_LEDGER_KEY = .*?\n\nconst BookshelfView = lazy",
    'const BookshelfView = lazy',
    'App-local weekly helpers',
)
text = replace_once(
    text,
    "const QuickEntryModal = lazy(() =>\n  import('./components/QuickEntryModal').then((module) => ({\n    default: module.QuickEntryModal,\n  })),\n);",
    "const WeeklyPlanningQuickEntryModal = lazy(() =>\n  import('./components/WeeklyPlanningQuickEntryModal').then((module) => ({\n    default: module.WeeklyPlanningQuickEntryModal,\n  })),\n);",
    'quick entry lazy component',
)
text = replace_once(
    text,
    "  const [weeklyApprovalOperations, setWeeklyApprovalOperations] =\n    useState<WeeklyDraftApprovalOperation[]>(loadWeeklyApprovalOperations);\n",
    '',
    'approval operation state',
)
text = replace_pattern(
    text,
    r"  const planningUserId = user\?\.id \?\? 'anonymous';\n  const \{ planningState, dispatchPlanningAction, getPlanningState \} = useWeeklyPlanningState\(.*?\n  const activeTimetableTerm = useMemo",
    '  const activeTimetableTerm = useMemo',
    'weekly planning state initialization',
)
text = replace_once(
    text,
    "  const activeTimetableTermId = activeTimetableTerm?.id ?? 'default';\n  const currentPath = window.location.pathname;\n\n  useEffect(() => {\n    if (typeof window === 'undefined') return;\n    window.localStorage.setItem(\n      WEEKLY_APPROVAL_LEDGER_KEY,\n      serializeWeeklyApprovalLedger(weeklyApprovalOperations),\n    );\n  }, [weeklyApprovalOperations]);\n",
    "  const activeTimetableTermId = activeTimetableTerm?.id ?? 'default';\n  const weeklyPlanning = useWeeklyPlanningApplication({\n    userId: user?.id,\n    selectedDate,\n    plans,\n    scheduleTemplates,\n    timetableTermId: activeTimetableTermId,\n    savePlanDraft,\n  });\n  const currentPath = window.location.pathname;\n",
    'weekly planning application initialization',
)
text = replace_pattern(
    text,
    r"  async function submitWeeklyPlanningTurn\(.*?\n  if \(currentPath === '/terms'\) \{",
    "  if (currentPath === '/terms') {",
    'App-local weekly planning functions',
)
text = replace_count(
    text,
    "              weeklyDraftBlocks={pendingWeeklyDraftBlocks}\n              onRemoveWeeklyDraftBlock={planningState.pendingTurn || planningState.pendingApproval\n                ? undefined\n                : (blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}",
    "              weeklyDraftBlocks={weeklyPlanning.pendingDraftBlocks}\n              onRemoveWeeklyDraftBlock={weeklyPlanning.canEditDraftBlocks\n                ? weeklyPlanning.removeDraftBlock\n                : undefined}",
    2,
    'week and day view weekly props',
)
text = replace_pattern(
    text,
    r"      \{isQuickEntryOpen \? \(\n        <Suspense fallback=\{null\}>\n          <QuickEntryModal.*?        </Suspense>\n      \) : null\}",
    "      {isQuickEntryOpen ? (\n        <Suspense fallback={null}>\n          <WeeklyPlanningQuickEntryModal\n            application={weeklyPlanning}\n            userId={user.id}\n            selectedDate={selectedDate}\n            plans={plans}\n            actuals={actuals}\n            materials={studyMaterials}\n            subjects={studySubjects}\n            onClose={() => setIsQuickEntryOpen(false)}\n            onSaveTodo={saveTodo}\n            onSavePlan={savePlanDraft}\n            onSaveStandaloneActual={saveStandaloneActual}\n            onSaveLinkedActual={saveActual}\n          />\n        </Suspense>\n      ) : null}",
    'quick entry weekly connection',
)
APP.write_text(text, encoding='utf-8')
