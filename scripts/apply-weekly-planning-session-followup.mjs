import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one anchor, got ${count}; anchor=${JSON.stringify(before.slice(0, 100))}`);
  writeFileSync(path, source.replace(before, after), 'utf8');
}

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningReducer.ts',
  `  if (\n    state.pendingApproval\n    && action.type !== 'load_state'\n    && action.type !== 'complete_approval'\n    && action.type !== 'fail_approval'\n  ) {\n    return state;\n  }`,
  `  if (\n    state.pendingApproval\n    && action.type !== 'load_state'\n    && action.type !== 'complete_approval'\n    && action.type !== 'fail_approval'\n  ) {\n    return state;\n  }\n\n  if (\n    state.pendingTurn\n    && action.type !== 'load_state'\n    && action.type !== 'commit_turn'\n    && action.type !== 'fail_turn'\n    && action.type !== 'cancel_turn'\n  ) {\n    return state;\n  }`,
);

{
  const path = 'src/App.tsx';
  const source = readFileSync(path, 'utf8');
  const before = `planningState.pendingApproval\n                ? undefined`;
  const after = `planningState.pendingTurn || planningState.pendingApproval\n                ? undefined`;
  const count = source.split(before).length - 1;
  if (count !== 2) throw new Error(`${path}: expected two busy removal guards, got ${count}`);
  writeFileSync(path, source.split(before).join(after), 'utf8');
}

replaceOnce(
  'src/App.tsx',
  `            scheduleTemplates={scheduleTemplates}\n            timetableTermId={activeTimetableTermId}\n            weeklyDraftBlocks={pendingWeeklyDraftBlocks}`,
  `            weeklyDraftBlocks={pendingWeeklyDraftBlocks}`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  RecurrenceWeekday,\n  ScheduleTemplate,\n  StudyMaterial,`,
  `  RecurrenceWeekday,\n  StudyMaterial,`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  scheduleTemplates?: ScheduleTemplate[];\n  timetableTermId?: string;\n  weeklyDraftBlocks: WeeklyPlanDraftBlock[];`,
  `  weeklyDraftBlocks: WeeklyPlanDraftBlock[];`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  scheduleTemplates = [],\n  timetableTermId,\n  weeklyDraftBlocks,`,
  `  weeklyDraftBlocks,`,
);
replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `scheduleTemplates={scheduleTemplates}\n                 timetableTermId={timetableTermId}\n                 onApplyDraft={onSavePlan}`,
  `onApplyDraft={onSavePlan}`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  SuggestionField,\n  ScheduleTemplate,\n  StudyMaterial,`,
  `  SuggestionField,\n  StudyMaterial,`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  scheduleTemplates?: ScheduleTemplate[];\n  timetableTermId?: string;\n  onApplyDraft:`,
  `  onApplyDraft:`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  scheduleTemplates = [],\n  timetableTermId,\n  onApplyDraft,`,
  `  onApplyDraft,`,
);
replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  void weeklyPlanningRevision;\n  void scheduleTemplates;\n  void timetableTermId;`,
  `  void weeklyPlanningRevision;`,
);

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningSessionState.property.test.ts',
  `  it('keeps draft blocks immutable for arbitrary mutation sequences during approval', () => {`,
  `  it('keeps the whole session immutable for arbitrary mutations during a pending turn', () => {\n    const actionArbitrary = fc.oneof(\n      fc.string().map((blockId) => ({ type: 'remove_draft_block' as const, blockId })),\n      fc.array(fc.string(), { maxLength: 5 }).map((blockIds) => ({\n        type: 'remove_draft_blocks' as const,\n        blockIds,\n      })),\n      fc.constant({ type: 'clear_draft_blocks' as const }),\n      fc.string().map((content) => ({\n        type: 'append_message' as const,\n        message: {\n          id: \`extra-\${content}\`,\n          role: 'user' as const,\n          content,\n          createdAt: '2026-07-16T00:00:00.000Z',\n        },\n      })),\n    );\n\n    fc.assert(fc.property(fc.array(actionArbitrary, { maxLength: 30 }), (actions) => {\n      const withDrafts = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), {\n        type: 'add_draft_blocks',\n        blocks: [draftBlock('draft-1'), draftBlock('draft-2')],\n      });\n      const pending = pendingTurn(withDrafts.revision);\n      const begun = weeklyPlanningReducer(withDrafts, {\n        type: 'begin_turn',\n        pending,\n        userMessage: {\n          id: 'user-message', role: 'user', content: '予定', createdAt: pending.startedAt,\n        },\n      });\n      const after = actions.reduce(weeklyPlanningReducer, begun);\n      expect(after).toBe(begun);\n      expect(after.pendingTurn).toEqual(pending);\n    }));\n  });\n\n  it('keeps draft blocks immutable for arbitrary mutation sequences during approval', () => {`,
);

console.log('weekly planning session follow-up applied');
