import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one finalize anchor, got ${count}`);
  writeFileSync(path, source.replace(before, after), 'utf8');
}

replaceOnce(
  'src/App.tsx',
  `              onSubmitWeeklyPlanningTurn={submitWeeklyPlanningTurn}\n              onResetWeeklyPlanningSession={() =>`,
  `              onSubmitWeeklyPlanningTurn={submitWeeklyPlanningTurn}\n              onAppendWeeklyPlanningMessage={(message) =>\n                dispatchPlanningAction({ type: 'append_message', message })\n              }\n              onResetWeeklyPlanningSession={() =>`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n  onResetWeeklyPlanningSession: () => void;`,
  `  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n  onAppendWeeklyPlanningMessage: (message: WeeklyPlanningMessage) => void;\n  onResetWeeklyPlanningSession: () => void;`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  onSubmitWeeklyPlanningTurn,\n  onResetWeeklyPlanningSession,`,
  `  onSubmitWeeklyPlanningTurn,\n  onAppendWeeklyPlanningMessage,\n  onResetWeeklyPlanningSession,`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `                 onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n                 onResetWeeklyPlanningSession={onResetWeeklyPlanningSession}`,
  `                 onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n                 onAppendWeeklyPlanningMessage={onAppendWeeklyPlanningMessage}\n                 onResetWeeklyPlanningSession={onResetWeeklyPlanningSession}`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n  onResetWeeklyPlanningSession: () => void;\n  onCreateWeeklyDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => void;\n  onRemoveWeeklyDraftBlock: (blockId: string) => void;\n  onClearWeeklyDraftBlocks: () => void;\n  onApproveWeeklyDraftBlocks: () => Promise<void>;`,
  `  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n  onAppendWeeklyPlanningMessage: (message: WeeklyPlanningMessage) => void;\n  onResetWeeklyPlanningSession: () => void;\n  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;\n  onRemoveWeeklyDraftBlock?: (blockId: string) => void;\n  onClearWeeklyDraftBlocks?: () => void;\n  onApproveWeeklyDraftBlocks?: () => Promise<void>;`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  onSubmitWeeklyPlanningTurn,\n  onResetWeeklyPlanningSession,`,
  `  onSubmitWeeklyPlanningTurn,\n  onAppendWeeklyPlanningMessage,\n  onResetWeeklyPlanningSession,`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);\n  void weeklyPlanningWeekStartDate;\n  void weeklyPlanningRevision;`,
  `  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);\n  void weeklyPlanningWeekStartDate;\n  void weeklyPlanningRevision;\n  void scheduleTemplates;\n  void timetableTermId;\n\n  function appendWeeklyPlanningMessage(\n    role: WeeklyPlanningMessage['role'],\n    content: string,\n  ) {\n    onAppendWeeklyPlanningMessage({\n      id: \`weekly-\${role}-message-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,\n      role,\n      content,\n      createdAt: new Date().toISOString(),\n    });\n  }`,
);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `    onClearWeeklyDraftBlocks();`, `    onClearWeeklyDraftBlocks?.();`);
replaceOnce('src/components/NaturalLanguageAssistant.tsx', `    onRemoveWeeklyDraftBlock(blockId);`, `    onRemoveWeeklyDraftBlock?.(blockId);`);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `    if (pendingWeeklyDraftBlocks.length === 0 || isWeeklyPlanningBusy) return;`,
  `    if (!onApproveWeeklyDraftBlocks || pendingWeeklyDraftBlocks.length === 0 || isWeeklyPlanningBusy) return;`,
);

console.log('weekly planning session UI finalized');
