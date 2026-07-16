import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one anchor, got ${count}`);
  writeFileSync(path, source.replace(before, after), 'utf8');
}

function replaceRegex(path, pattern, after) {
  const source = readFileSync(path, 'utf8');
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${path}: regex anchor mismatch`);
  writeFileSync(path, source.replace(pattern, after), 'utf8');
}

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts',
  `export interface WeeklyPlanningTurnExecutionResult {\n  state: PlanningIntakeState;\n  message: string;\n  draftCandidates: WeeklyDraftCandidate[];\n}\n`,
  `export interface WeeklyPlanningTurnExecutionResult {\n  state: PlanningIntakeState;\n  message: string;\n  draftCandidates: WeeklyDraftCandidate[];\n}\n\nexport interface WeeklyPlanningTurnSubmissionResult {\n  accepted: boolean;\n  draftCandidates: WeeklyDraftCandidate[];\n}\n`,
);

replaceOnce(
  'src/App.tsx',
  `import type { WeeklyDraftApprovalOperation } from './features/weeklyPlanning/planning/weeklyPlanningApprovalTypes';\nimport { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';`,
  `import type { WeeklyDraftApprovalOperation } from './features/weeklyPlanning/planning/weeklyPlanningApprovalTypes';\nimport type {\n  WeeklyPlanningMessage,\n  WeeklyPlanningPendingApproval,\n  WeeklyPlanningPendingTurn,\n} from './features/weeklyPlanning/types';\nimport { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';\nimport {\n  executeWeeklyPlanningTurn,\n  type WeeklyPlanningTurnSubmissionResult,\n} from './features/weeklyPlanning/weeklyPlanningTurnExecutor';`,
);

replaceOnce(
  'src/App.tsx',
  `function loadWeeklyApprovalOperations(): WeeklyDraftApprovalOperation[] {\n  if (typeof window === 'undefined') return [];\n  const value = window.localStorage.getItem(WEEKLY_APPROVAL_LEDGER_KEY);\n  return value ? parseWeeklyApprovalLedger(value)?.operations ?? [] : [];\n}\n`,
  `function loadWeeklyApprovalOperations(): WeeklyDraftApprovalOperation[] {\n  if (typeof window === 'undefined') return [];\n  const value = window.localStorage.getItem(WEEKLY_APPROVAL_LEDGER_KEY);\n  return value ? parseWeeklyApprovalLedger(value)?.operations ?? [] : [];\n}\n\nfunction createWeeklyPlanningRequestId(prefix: string): string {\n  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'\n    ? \`\${prefix}-\${crypto.randomUUID()}\`\n    : \`\${prefix}-\${Date.now()}-\${Math.random().toString(36).slice(2, 10)}\`;\n}\n\nfunction createWeeklyPlanningMessage(\n  role: WeeklyPlanningMessage['role'],\n  content: string,\n): WeeklyPlanningMessage {\n  return {\n    id: createWeeklyPlanningRequestId(\`weekly-\${role}-message\`),\n    role,\n    content,\n    createdAt: new Date().toISOString(),\n  };\n}\n`,
);

replaceOnce(
  'src/App.tsx',
  `  const { planningState, dispatchPlanningAction } = useWeeklyPlanningState(\n    planningUserId,\n    selectedDate,\n  );`,
  `  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(\n    planningUserId,\n    selectedDate,\n  );`,
);

replaceRegex(
  'src/App.tsx',
  /  async function approveWeeklyDraftBlocks\(\) \{[\s\S]*?\n  \}\n\n  if \(currentPath === '\/terms'\)/,
  `  async function submitWeeklyPlanningTurn(\n    userText: string,\n  ): Promise<WeeklyPlanningTurnSubmissionResult> {\n    const snapshot = getPlanningState();\n    if (!user || snapshot.pendingTurn || snapshot.pendingApproval) {\n      return { accepted: false, draftCandidates: [] };\n    }\n\n    const pending: WeeklyPlanningPendingTurn = {\n      requestId: createWeeklyPlanningRequestId('weekly-turn'),\n      weekStartDate: snapshot.weekStartDate,\n      baseRevision: snapshot.revision,\n      startedAt: new Date().toISOString(),\n    };\n    const userMessage = createWeeklyPlanningMessage('user', userText);\n    const begun = dispatchPlanningAction({ type: 'begin_turn', pending, userMessage });\n    if (begun.pendingTurn?.requestId !== pending.requestId) {\n      return { accepted: false, draftCandidates: [] };\n    }\n\n    try {\n      const result = await executeWeeklyPlanningTurn({\n        previousState: snapshot.intakeState,\n        messages: snapshot.messages,\n        userText,\n        selectedDate,\n        userId: user.id,\n        plans,\n        scheduleTemplates,\n        timetableTermId: activeTimetableTermId,\n        traceRequestId: pending.requestId,\n      });\n      const assistantMessage = createWeeklyPlanningMessage('assistant', result.message);\n      const committed = dispatchPlanningAction({\n        type: 'commit_turn',\n        pending,\n        intakeState: result.state,\n        assistantMessage,\n      });\n      const accepted = committed.messages.some((message) => message.id === assistantMessage.id)\n        && committed.pendingTurn === undefined\n        && committed.weekStartDate === pending.weekStartDate;\n      return {\n        accepted,\n        draftCandidates: accepted ? result.draftCandidates : [],\n      };\n    } catch {\n      const message = '週間計画の会話状態を更新できませんでした。';\n      dispatchPlanningAction({\n        type: 'fail_turn',\n        pending,\n        assistantMessage: createWeeklyPlanningMessage('assistant', message),\n      });\n      throw new Error(message);\n    }\n  }\n\n  async function approveWeeklyDraftBlocks() {\n    if (!user) return;\n    const snapshot = getPlanningState();\n    const blocks = snapshot.draftBlocks.filter((block) => block.status === 'draft');\n    if (blocks.length === 0 || snapshot.pendingTurn || snapshot.pendingApproval) return;\n\n    const pending: WeeklyPlanningPendingApproval = {\n      requestId: createWeeklyPlanningRequestId('weekly-approval'),\n      weekStartDate: snapshot.weekStartDate,\n      baseRevision: snapshot.revision,\n      blockIds: blocks.map((block) => block.id),\n      startedAt: new Date().toISOString(),\n    };\n    const begun = dispatchPlanningAction({ type: 'begin_approval', pending });\n    if (begun.pendingApproval?.requestId !== pending.requestId) return;\n\n    try {\n      const firstMetadata = blocks[0]?.behaviorMetadata?.previewMetadata;\n      const proposalRecords = (firstMetadata?.assumptionDependencies ?? []).map((dependency) => ({\n        proposalId: dependency.proposalId,\n        conversationId: 'weekly-planning-session',\n        slot: 'duration' as const,\n        targetRef: dependency.targetRef,\n        proposedValue: 0,\n        proposedUnit: 'minutes' as const,\n        reasonCode: 'missing_duration' as const,\n        sourceFactRefs: [dependency.targetRef],\n        createdAtTurnId: 'preview-dependency',\n        createdFromStateRevision: dependency.proposalCreatedFromStateRevision,\n        status: 'pending' as const,\n      }));\n      const guard = validateWeeklyPreviewApproval({\n        blocks,\n        currentStateRevision: firstMetadata?.stateRevision ?? -1,\n        userId: user.id,\n        proposalRecords,\n      });\n      if (!guard.allowed) {\n        switch (guard.attempt.kind) {\n          case 'stale_preview_approval_attempt':\n            throw new Error('現在の条件と一致しない仮予定です。最新条件で再計算してください。');\n          case 'pending_assumption_preview_approval_attempt':\n            throw new Error('未確認の仮定があります。仮定を確認してから最新案を再計算してください。');\n          default:\n            throw new Error('この仮予定は保存できません。最新案を作り直してください。');\n        }\n      }\n\n      const existingOperation = weeklyApprovalOperations.find((operation) =>\n        operation.userId === user.id\n        && operation.previewId === guard.metadata.previewId\n        && operation.previewStateRevision === guard.metadata.stateRevision,\n      );\n      const operation = existingOperation ?? createWeeklyDraftApprovalOperation({\n        userId: user.id,\n        metadata: guard.metadata,\n        blocks,\n        now: new Date().toISOString(),\n      });\n      const result = await executeWeeklyDraftApproval({\n        operation,\n        blocks,\n        dependencies: {\n          async findExistingPlanId({ sourceDraftBlockId }) {\n            const marker = \`[weekly-source:\${sourceDraftBlockId}]\`;\n            return plans.find((plan) => plan.userId === user.id && plan.memo.includes(marker))?.id;\n          },\n          async saveBlock({ block, source }) {\n            const draft = createPlanDraftFromWeeklyDraftBlock(block, user.id);\n            const sourceMarker = \`[weekly-source:\${source.sourceDraftBlockId}]\`;\n            const operationMarker = \`[weekly-approval:\${source.approvalOperationId}]\`;\n            await savePlanDraft({\n              ...draft,\n              memo: [draft.memo, sourceMarker, operationMarker].filter(Boolean).join(' / '),\n            });\n            return { planId: \`weekly-plan:\${source.sourceDraftBlockId}\` };\n          },\n          now: () => new Date().toISOString(),\n        },\n      });\n      setWeeklyApprovalOperations((current) => [\n        ...current.filter((item) => item.approvalOperationId !== result.approvalOperationId),\n        result,\n      ]);\n      const completedBlockIds = result.items\n        .filter((item) => item.status === 'saved' || item.status === 'skipped_duplicate')\n        .map((item) => item.sourceDraftBlockId);\n      const failed = result.status === 'failed' || result.status === 'partially_saved';\n      const message = failed\n        ? '一部の仮予定を保存できませんでした。未保存分だけ再試行できます。'\n        : \`\${completedBlockIds.length}件の仮予定を通常予定として保存しました。\`;\n      dispatchPlanningAction({\n        type: 'complete_approval',\n        pending,\n        completedBlockIds,\n        assistantMessage: createWeeklyPlanningMessage('assistant', message),\n      });\n      if (failed) throw new Error(message);\n    } catch (error) {\n      const current = getPlanningState();\n      if (current.pendingApproval?.requestId === pending.requestId) {\n        dispatchPlanningAction({ type: 'fail_approval', pending });\n      }\n      throw error;\n    }\n  }\n\n  if (currentPath === '/terms')`,
);

replaceOnce(
  'src/App.tsx',
  `              onRemoveWeeklyDraftBlock={(blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}`,
  `              onRemoveWeeklyDraftBlock={planningState.pendingApproval\n                ? undefined\n                : (blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}`,
);
replaceOnce(
  'src/App.tsx',
  `               onRemoveWeeklyDraftBlock={(blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}`,
  `               onRemoveWeeklyDraftBlock={planningState.pendingApproval\n                 ? undefined\n                 : (blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}`,
);
replaceOnce(
  'src/App.tsx',
  `             weeklyPlanningMessages={planningState.messages}\n              weeklyPlanningIntakeState={planningState.intakeState ?? null}\n              onAppendWeeklyPlanningMessage={(message) =>\n                dispatchPlanningAction({ type: 'append_message', message })\n              }\n              onSetWeeklyPlanningIntakeState={(state) =>\n                dispatchPlanningAction({ type: 'set_intake_state', state })\n              }\n              onClearWeeklyPlanningConversation={() =>\n                dispatchPlanningAction({ type: 'clear_conversation' })\n              }\n              onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}`,
  `             weeklyPlanningMessages={planningState.messages}\n              weeklyPlanningIntakeState={planningState.intakeState ?? null}\n              weeklyPlanningWeekStartDate={planningState.weekStartDate}\n              weeklyPlanningRevision={planningState.revision}\n              weeklyPlanningPendingTurn={planningState.pendingTurn}\n              weeklyPlanningPendingApproval={planningState.pendingApproval}\n              onSubmitWeeklyPlanningTurn={submitWeeklyPlanningTurn}\n              onResetWeeklyPlanningSession={() =>\n                dispatchPlanningAction({ type: 'reset_session' })\n              }\n              onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';\nimport type {\n  WeeklyPlanDraftBlock,\n  WeeklyPlanningMessage,\n} from '../features/weeklyPlanning/types';`,
  `import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';\nimport type {\n  WeeklyPlanDraftBlock,\n  WeeklyPlanningMessage,\n  WeeklyPlanningPendingApproval,\n  WeeklyPlanningPendingTurn,\n} from '../features/weeklyPlanning/types';\nimport type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\nimport { resolveInitialQuickEntryInputMethod } from './weeklyPlanningConversationMode';`,
);
replaceRegex(
  'src/components/QuickEntryModal.tsx',
  /interface QuickEntryModalProps \{[\s\S]*?\n\}/,
  `interface QuickEntryModalProps {\n  userId: string;\n  selectedDate: string;\n  plans: Plan[];\n  actuals: Actual[];\n  materials: StudyMaterial[];\n  subjects: StudySubject[];\n  scheduleTemplates?: ScheduleTemplate[];\n  timetableTermId?: string;\n  weeklyDraftBlocks: WeeklyPlanDraftBlock[];\n  weeklyPlanningMessages: WeeklyPlanningMessage[];\n  weeklyPlanningIntakeState: PlanningIntakeState | null;\n  weeklyPlanningWeekStartDate: string;\n  weeklyPlanningRevision: number;\n  weeklyPlanningPendingTurn?: WeeklyPlanningPendingTurn;\n  weeklyPlanningPendingApproval?: WeeklyPlanningPendingApproval;\n  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n  onResetWeeklyPlanningSession: () => void;\n  onCreateWeeklyDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => void;\n  onRemoveWeeklyDraftBlock: (blockId: string) => void;\n  onClearWeeklyDraftBlocks: () => void;\n  onApproveWeeklyDraftBlocks: () => Promise<void>;\n  onClose: () => void;\n  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;\n  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;\n  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;\n  onSaveLinkedActual: (plan: Plan, draft: ActualDraft) => Promise<void>;\n}`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  weeklyDraftBlocks = [],\n  weeklyPlanningMessages = [],\n  weeklyPlanningIntakeState = null,\n  onAppendWeeklyPlanningMessage,\n  onSetWeeklyPlanningIntakeState,\n  onClearWeeklyPlanningConversation,\n  onCreateWeeklyDraftBlocks,`,
  `  weeklyDraftBlocks,\n  weeklyPlanningMessages,\n  weeklyPlanningIntakeState,\n  weeklyPlanningWeekStartDate,\n  weeklyPlanningRevision,\n  weeklyPlanningPendingTurn,\n  weeklyPlanningPendingApproval,\n  onSubmitWeeklyPlanningTurn,\n  onResetWeeklyPlanningSession,\n  onCreateWeeklyDraftBlocks,`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  const [inputMethod, setInputMethod] = useState<QuickEntryInputMethod>('manual');`,
  `  const [inputMethod, setInputMethod] = useState<QuickEntryInputMethod>(() =>\n    resolveInitialQuickEntryInputMethod({\n      messages: weeklyPlanningMessages,\n      intakeState: weeklyPlanningIntakeState,\n      draftBlockCount: weeklyDraftBlocks.length,\n      pendingTurn: weeklyPlanningPendingTurn,\n      pendingApproval: weeklyPlanningPendingApproval,\n    }),\n  );`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `                 weeklyPlanningMessages={weeklyPlanningMessages}\n                 weeklyPlanningIntakeState={weeklyPlanningIntakeState}\n                 onAppendWeeklyPlanningMessage={onAppendWeeklyPlanningMessage}\n                 onSetWeeklyPlanningIntakeState={onSetWeeklyPlanningIntakeState}\n                 onClearWeeklyPlanningConversation={onClearWeeklyPlanningConversation}\n                 onCreateWeeklyDraftBlocks={onCreateWeeklyDraftBlocks}`,
  `                 weeklyPlanningMessages={weeklyPlanningMessages}\n                 weeklyPlanningIntakeState={weeklyPlanningIntakeState}\n                 weeklyPlanningWeekStartDate={weeklyPlanningWeekStartDate}\n                 weeklyPlanningRevision={weeklyPlanningRevision}\n                 weeklyPlanningPendingTurn={weeklyPlanningPendingTurn}\n                 weeklyPlanningPendingApproval={weeklyPlanningPendingApproval}\n                 onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n                 onResetWeeklyPlanningSession={onResetWeeklyPlanningSession}\n                 onCreateWeeklyDraftBlocks={onCreateWeeklyDraftBlocks}`,
);

replaceOnce('src/components/NaturalLanguageAssistant.tsx', `import { getAiConfig, getAiConfigValidationMessage } from '../lib/aiConfig';\n`, ``);
for (const statement of [
  `import { createAiWeeklyPlanningDialogueRenderer } from '../features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer';\n`,
  `import { renderWeeklyPlanningDialogueMessage } from '../features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer';\n`,
  `import { createAiWeeklyPlanningInterpreter } from '../features/weeklyPlanning/intake/weeklyPlanningAiInterpreter';\n`,
  `import {\n  runWeeklyPlanningBehaviorAwarePipeline,\n  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,\n} from '../features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline';\n`,
]) replaceOnce('src/components/NaturalLanguageAssistant.tsx', statement, '');
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `import type {\n  AiInputMode,\n  WeeklyPlanDraftBlock,\n  WeeklyPlanningMessage,\n} from '../features/weeklyPlanning/types';`,
  `import type {\n  AiInputMode,\n  WeeklyPlanDraftBlock,\n  WeeklyPlanningMessage,\n  WeeklyPlanningPendingApproval,\n  WeeklyPlanningPendingTurn,\n} from '../features/weeklyPlanning/types';\nimport type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';`,
);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `const WEEKLY_PLANNING_RECENT_TURN_LIMIT = 6;\n\n`, '');
replaceRegex(
  'src/components/NaturalLanguageAssistant.tsx',
  /interface NaturalLanguageAssistantProps \{[\s\S]*?\n\}/,
  `interface NaturalLanguageAssistantProps {\n  selectedDate: string;\n  userId: string;\n  plans: Plan[];\n  materials?: StudyMaterial[];\n  subjects?: StudySubject[];\n  scheduleTemplates?: ScheduleTemplate[];\n  timetableTermId?: string;\n  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;\n  weeklyDraftBlocks: WeeklyPlanDraftBlock[];\n  weeklyPlanningMessages: WeeklyPlanningMessage[];\n  weeklyPlanningIntakeState: PlanningIntakeState | null;\n  weeklyPlanningWeekStartDate: string;\n  weeklyPlanningRevision: number;\n  weeklyPlanningPendingTurn?: WeeklyPlanningPendingTurn;\n  weeklyPlanningPendingApproval?: WeeklyPlanningPendingApproval;\n  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n  onResetWeeklyPlanningSession: () => void;\n  onCreateWeeklyDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => void;\n  onRemoveWeeklyDraftBlock: (blockId: string) => void;\n  onClearWeeklyDraftBlocks: () => void;\n  onApproveWeeklyDraftBlocks: () => Promise<void>;\n  embedded?: boolean;\n}`,
);
replaceRegex(
  'src/components/NaturalLanguageAssistant.tsx',
  /function createWeeklyPlanningMessage\([\s\S]*?\n\}\n\nexport function NaturalLanguageAssistant/,
  `export function NaturalLanguageAssistant`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  weeklyDraftBlocks = [],\n  weeklyPlanningMessages: persistedWeeklyPlanningMessages,\n  weeklyPlanningIntakeState: persistedWeeklyPlanningIntakeState,\n  onAppendWeeklyPlanningMessage,\n  onSetWeeklyPlanningIntakeState,\n  onClearWeeklyPlanningConversation,\n  onCreateWeeklyDraftBlocks,`,
  `  weeklyDraftBlocks,\n  weeklyPlanningMessages,\n  weeklyPlanningIntakeState,\n  weeklyPlanningWeekStartDate,\n  weeklyPlanningRevision,\n  weeklyPlanningPendingTurn,\n  weeklyPlanningPendingApproval,\n  onSubmitWeeklyPlanningTurn,\n  onResetWeeklyPlanningSession,\n  onCreateWeeklyDraftBlocks,`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `    resolveInitialAiInputMode({\n      messages: persistedWeeklyPlanningMessages,\n      intakeState: persistedWeeklyPlanningIntakeState,\n    }),`,
  `    resolveInitialAiInputMode({\n      messages: weeklyPlanningMessages,\n      intakeState: weeklyPlanningIntakeState,\n      draftBlockCount: weeklyDraftBlocks.length,\n      pendingTurn: weeklyPlanningPendingTurn,\n      pendingApproval: weeklyPlanningPendingApproval,\n    }),`,
);
replaceRegex(
  'src/components/NaturalLanguageAssistant.tsx',
  /  const \[localWeeklyPlanningMessages,[\s\S]*?\n  const \[weeklyPlanningPreviewBlocks,/,
  `  const [weeklyPlanningPreviewBlocks,`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  const runtimeInfo = getPlannerAiRuntimeInfo();`,
  `  const runtimeInfo = getPlannerAiRuntimeInfo();\n  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);\n  void weeklyPlanningWeekStartDate;\n  void weeklyPlanningRevision;`,
);
replaceRegex(
  'src/components/NaturalLanguageAssistant.tsx',
  /  function appendWeeklyPlanningMessage\([\s\S]*?\n  function resetWeeklyPlanningSession\(\) \{/,
  `  function resetWeeklyPlanningSession() {`,
);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `    clearWeeklyPlanningConversationState();`, `    onResetWeeklyPlanningSession();`);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `    onClearWeeklyDraftBlocks?.();`, `    onClearWeeklyDraftBlocks();`);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `    onRemoveWeeklyDraftBlock?.(blockId);`, `    onRemoveWeeklyDraftBlock(blockId);`);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `        isAnalyzing={isAnalyzing}`, `        isAnalyzing={Boolean(weeklyPlanningPendingTurn)}`);
replaceRegex(
  'src/components/NaturalLanguageAssistant.tsx',
  /  async function handleCreateWeeklyDrafts\(\) \{[\s\S]*?\n  \}\n\n  function handlePromoteWeeklyPreviewToDrafts/,
  `  async function handleCreateWeeklyDrafts() {\n    const trimmedText = text.trim();\n    if (!trimmedText || isWeeklyPlanningBusy) {\n      if (!trimmedText) setError('週間計画にしたい内容を入力してください。');\n      return;\n    }\n    setText('');\n    setError('');\n    setStatus('');\n    try {\n      const result = await onSubmitWeeklyPlanningTurn(trimmedText);\n      if (!result.accepted) return;\n      const nextPreviewBlocks = createWeeklyPlanningPreviewBlocks(result.draftCandidates);\n      setWeeklyPlanningPreviewCandidates(result.draftCandidates);\n      setWeeklyPlanningPreviewBlocks(nextPreviewBlocks);\n      if (nextPreviewBlocks.length > 0) {\n        setWeeklyDraftPreviewMode('overview');\n        setSelectedWeeklyDraftDate('');\n      }\n    } catch (error) {\n      setError(error instanceof Error ? error.message : '週間計画の会話状態を更新できませんでした。');\n    }\n  }\n\n  function handlePromoteWeeklyPreviewToDrafts`,
);
replaceRegex(
  'src/components/NaturalLanguageAssistant.tsx',
  /  async function handleApproveWeeklyDrafts\(\) \{[\s\S]*?\n  \}\n\n  function openWeeklyDraftDay/,
  `  async function handleApproveWeeklyDrafts() {\n    if (pendingWeeklyDraftBlocks.length === 0 || isWeeklyPlanningBusy) return;\n    setError('');\n    try {\n      await onApproveWeeklyDraftBlocks();\n    } catch (error) {\n      setError(error instanceof Error ? error.message : '仮予定の承認に失敗しました。');\n    }\n  }\n\n  function openWeeklyDraftDay`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `                                  onClick={() => removeVisibleWeeklyDraftBlock(block.id)}\n                                  type="button"`,
  `                                  onClick={() => removeVisibleWeeklyDraftBlock(block.id)}\n                                  type="button"\n                                  disabled={Boolean(weeklyPlanningPendingApproval)}`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `                    onClick={clearWeeklyPlanningDraftsOnly}\n                    type="button"`,
  `                    onClick={clearWeeklyPlanningDraftsOnly}\n                    type="button"\n                    disabled={Boolean(weeklyPlanningPendingApproval)}`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `                    disabled={isAnalyzing}\n                  >\n                    一括承認して保存`,
  `                    disabled={isWeeklyPlanningBusy}\n                  >\n                    {weeklyPlanningPendingApproval ? '保存中…' : '一括承認して保存'}`,
);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `           {!isAnalyzing ? (`, `           {!isWeeklyPlanningBusy ? (`);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `                 {weeklyPlanningMessages.length > 0 ? (`,
  `                 {weeklyPlanningMessages.length > 0\n                   || weeklyPlanningIntakeState\n                   || weeklyDraftBlocks.length > 0\n                   || weeklyPlanningPreviewBlocks.length > 0 ? (`,
);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `                     履歴をクリア`, `                     この週の相談をリセット`);

writeFileSync('src/components/weeklyPlanningConversationMode.test.ts', `import { describe, expect, it } from 'vitest';\nimport { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';\nimport {\n  resolveInitialAiInputMode,\n  resolveInitialQuickEntryInputMethod,\n} from './weeklyPlanningConversationMode';\n\nconst pendingTurn = {\n  requestId: 'request-1',\n  weekStartDate: '2026-07-13',\n  baseRevision: 0,\n  startedAt: '2026-07-16T00:00:00.000Z',\n};\n\ndescribe('weekly planning session resume mode', () => {\n  it.each([\n    { messages: [{ id: 'm1', role: 'user' as const, content: '予定', createdAt: pendingTurn.startedAt }], intakeState: null },\n    { messages: [], intakeState: createInitialPlanningIntakeState() },\n    { messages: [], intakeState: null, draftBlockCount: 1 },\n    { messages: [], intakeState: null, pendingTurn },\n  ])('reopens both outer and inner AI views for an active session', (session) => {\n    expect(resolveInitialQuickEntryInputMethod(session)).toBe('ai');\n    expect(resolveInitialAiInputMode(session)).toBe('weekly_planning');\n  });\n\n  it('keeps manual/chat defaults without a saved session', () => {\n    const empty = { messages: [], intakeState: null };\n    expect(resolveInitialQuickEntryInputMethod(empty)).toBe('manual');\n    expect(resolveInitialAiInputMode(empty)).toBe('chat');\n  });\n});\n`, 'utf8');

console.log('weekly planning session UI ownership applied');
