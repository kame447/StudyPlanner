from pathlib import Path

# 1. Collapse effective no-op canonicalization after entity binding/corrections.
path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts')
text = path.read_text()
marker = """function contextualBindingObservations(params: {\n"""
helper = """function collapseWeeklyPlanningNoOpCanonicalizationV5(params: {\n  originalGraph: WeeklyPlanningFactGraphV5;\n  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;\n}): WeeklyPlanningSemanticCanonicalizationResultV5 {\n  const diff = params.canonicalization.diff;\n  if (params.canonicalization.status !== 'applied' || !diff) {\n    return params.canonicalization;\n  }\n  const hasFactChanges = diff.added.length > 0\n    || diff.superseded.length > 0\n    || diff.removed.length > 0;\n  if (hasFactChanges) return params.canonicalization;\n  return {\n    ...params.canonicalization,\n    graph: params.originalGraph,\n    diff: {\n      ...diff,\n      toRevision: params.originalGraph.revision,\n    },\n  };\n}\n\n"""
assert marker in text
text = text.replace(marker, helper + marker, 1)
old = """      const canonicalization = correctionResult.canonicalization;\n"""
new = """      const canonicalization = collapseWeeklyPlanningNoOpCanonicalizationV5({\n        originalGraph: graph,\n        canonicalization: correctionResult.canonicalization,\n      });\n"""
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)

# 2. Explicitly model preview preservation in turn results/actions.
path = Path('src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts')
text = path.read_text()
old = """  draftCandidates: WeeklyDraftCandidate[];\n  stableV5Graph?: WeeklyPlanningFactGraphV5;\n"""
new = """  draftCandidates: WeeklyDraftCandidate[];\n  preserveExistingPreview?: boolean;\n  stableV5Graph?: WeeklyPlanningFactGraphV5;\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

path = Path('src/features/weeklyPlanning/types.ts')
text = path.read_text()
old = """      assistantMessage: WeeklyPlanningMessage;\n      draftCandidates?: WeeklyDraftCandidate[];\n    }\n"""
new = """      assistantMessage: WeeklyPlanningMessage;\n      draftCandidates?: WeeklyDraftCandidate[];\n      preservePreviewCandidates?: boolean;\n    }\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

path = Path('src/features/weeklyPlanning/weeklyPlanningTurnController.ts')
text = path.read_text()
old = """      assistantMessage,\n      draftCandidates: executionResult.draftCandidates,\n    });\n"""
new = """      assistantMessage,\n      draftCandidates: executionResult.draftCandidates,\n      preservePreviewCandidates: executionResult.preserveExistingPreview,\n    });\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

path = Path('src/features/weeklyPlanning/weeklyPlanningReducer.ts')
text = path.read_text()
old = """      const draftCandidates = action.draftCandidates ?? [];\n      return withMutation(state, {\n        ...state,\n        ...appendAssistantMessage(state, action.assistantMessage),\n        mode: modeAfterTurnCommit(state, draftCandidates.length),\n        intakeState: action.intakeState,\n        previewCandidates: draftCandidates,\n        pendingTurn: undefined,\n      });\n"""
new = """      const draftCandidates = action.preservePreviewCandidates\n        ? state.previewCandidates ?? []\n        : action.draftCandidates ?? [];\n      return withMutation(state, {\n        ...state,\n        ...appendAssistantMessage(state, action.assistantMessage),\n        mode: modeAfterTurnCommit(state, draftCandidates.length),\n        intakeState: action.intakeState,\n        previewCandidates: draftCandidates,\n        pendingTurn: undefined,\n      });\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

# 3. Runtime requires a real semantic change for update_plan re-preview, and preserves old preview on no-op.
path = Path('src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts')
text = path.read_text()
old = """  questionFactId?: string;\n  authorized: boolean;\n}): PlanningIntakeState {\n  const previous = params.previousState ?? emptyCompatibilityState();\n  const hasDraft = params.draftCandidates.length > 0;\n  return {\n    ...previous,\n    status: hasDraft\n      ? 'draft_ready'\n"""
new = """  questionFactId?: string;\n  authorized: boolean;\n  preserveExistingPreview?: boolean;\n}): PlanningIntakeState {\n  const previous = params.previousState ?? emptyCompatibilityState();\n  const hasDraft = params.draftCandidates.length > 0;\n  const hasPreview = hasDraft || Boolean(params.preserveExistingPreview);\n  return {\n    ...previous,\n    status: hasPreview\n      ? 'draft_ready'\n"""
assert old in text
text = text.replace(old, new, 1)
old = """    shouldCreateDraft: hasDraft,\n    shouldSavePlan: false,\n    draftGenerationIntent: params.authorized ? 'user_authorized' : 'not_requested',\n"""
new = """    shouldCreateDraft: params.preserveExistingPreview ? previous.shouldCreateDraft : hasDraft,\n    shouldSavePlan: false,\n    draftGenerationIntent: params.preserveExistingPreview\n      ? previous.draftGenerationIntent\n      : params.authorized ? 'user_authorized' : 'not_requested',\n"""
assert old in text
text = text.replace(old, new, 1)
old = """  const planningIntent = semantic.normalization.document?.planningIntent ?? null;\n  const authorized = isWeeklyPlanningStableV5PreviewAuthorized({\n    previousStatus: input.previousState?.status ?? null,\n    planningIntent,\n  });\n"""
new = """  const planningIntent = semantic.normalization.document?.planningIntent ?? null;\n  const semanticDiff = semantic.canonicalization?.diff;\n  const semanticChanged = Boolean(\n    semanticDiff\n    && (semanticDiff.added.length > 0\n      || semanticDiff.superseded.length > 0\n      || semanticDiff.removed.length > 0),\n  );\n  const authorized = isWeeklyPlanningStableV5PreviewAuthorized({\n    previousStatus: input.previousState?.status ?? null,\n    planningIntent,\n    semanticChanged,\n  });\n"""
assert old in text
text = text.replace(old, new, 1)
old = """      authorization: {\n        planningIntent,\n        criterion: 'planningIntent === create_plan',\n        authorized,\n      },\n"""
new = """      authorization: {\n        planningIntent,\n        semanticChanged,\n        criterion: 'create_plan OR (draft_ready + update_plan + semanticChanged)',\n        authorized,\n      },\n"""
assert old in text
text = text.replace(old, new, 1)
anchor = """  if (!authorized) {\n    const message = '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。';\n"""
replacement = """  if (\n    !authorized\n    && input.previousState?.status === 'draft_ready'\n    && !semanticChanged\n  ) {\n    const message = '仮予定候補は変更していません。内容を修正する場合は条件を入力してください。問題なければ下の「この内容で仮予定にする」ボタンを押してください。';\n    const output = {\n      state: compatibilityState({\n        previousState: input.previousState,\n        userText: input.userText,\n        message,\n        draftCandidates: [],\n        authorized: false,\n        preserveExistingPreview: true,\n      }),\n      message,\n      draftCandidates: [],\n      preserveExistingPreview: true,\n    };\n    traceBranch({\n      requestId: input.traceRequestId,\n      branch: 'preview_unchanged',\n      basis: {\n        planningIntent,\n        semanticChanged,\n        previousStatus: input.previousState.status,\n      },\n      output,\n    });\n    return output;\n  }\n  if (!authorized) {\n    const message = '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。';\n"""
assert anchor in text
text = text.replace(anchor, replacement, 1)
old = """  const message = `${preview.candidates.length}件の仮予定候補を作りました。内容を確認して、問題なければ仮予定へ追加してください。`;\n"""
new = """  const message = `${preview.candidates.length}件の仮予定候補を作りました。内容を確認して、問題なければ下の「この内容で仮予定にする」ボタンを押してください。`;\n"""
assert old in text
text = text.replace(old, new, 1)
old = """export function isWeeklyPlanningStableV5PreviewAuthorized(params: {\n  previousStatus: PlanningIntakeState['status'] | null;\n  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown' | null;\n}): boolean {\n  return params.planningIntent === 'create_plan'\n    || (params.previousStatus === 'draft_ready' && params.planningIntent === 'update_plan');\n}\n"""
new = """export function isWeeklyPlanningStableV5PreviewAuthorized(params: {\n  previousStatus: PlanningIntakeState['status'] | null;\n  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown' | null;\n  semanticChanged: boolean;\n}): boolean {\n  return params.planningIntent === 'create_plan'\n    || (\n      params.previousStatus === 'draft_ready'\n      && params.planningIntent === 'update_plan'\n      && params.semanticChanged\n    );\n}\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

# 4. Keep the UI control label through AI rendering.
path = Path('src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueContext.ts')
text = path.read_text()
old = """  const labels = new Set(recognizedTaskLabels(params.questionCode, params.fallbackText));\n"""
new = """  const labels = new Set(recognizedTaskLabels(params.questionCode, params.fallbackText));\n  if (params.fallbackText.includes('「この内容で仮予定にする」')) {\n    labels.add('この内容で仮予定にする');\n  }\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

# 5. Regressions.
path = Path('src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts')
text = path.read_text()
old = """    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'draft_ready',\n      planningIntent: 'update_plan',\n    })).toBe(true);\n    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'needs_scope',\n      planningIntent: 'update_plan',\n    })).toBe(false);\n    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'draft_ready',\n      planningIntent: 'discuss',\n    })).toBe(false);\n"""
new = """    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'draft_ready',\n      planningIntent: 'update_plan',\n      semanticChanged: true,\n    })).toBe(true);\n    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'draft_ready',\n      planningIntent: 'update_plan',\n      semanticChanged: false,\n    })).toBe(false);\n    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'needs_scope',\n      planningIntent: 'update_plan',\n      semanticChanged: true,\n    })).toBe(false);\n    expect(isWeeklyPlanningStableV5PreviewAuthorized({\n      previousStatus: 'draft_ready',\n      planningIntent: 'discuss',\n      semanticChanged: false,\n    })).toBe(false);\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

path = Path('src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueContext.test.ts')
text = path.read_text()
insert = """\n  it('preserves the preview promotion control label in status rendering', () => {\n    expect(requiredLabelsForStableV5Dialogue({\n      questionCode: null,\n      fallbackText: '問題なければ下の「この内容で仮予定にする」ボタンを押してください。',\n    })).toEqual(['この内容で仮予定にする']);\n  });\n"""
anchor = "\n  it('treats a deterministic information request without a question code as a question action', () => {"
assert anchor in text
text = text.replace(anchor, insert + anchor, 1)
path.write_text(text)

path = Path('src/features/weeklyPlanning/weeklyPlanningReducer.test.ts')
text = path.read_text()
insert = r'''

  it('preserves an existing preview when a committed no-op turn explicitly requests preservation', () => {
    const initial = createInitialPlanningState('2026-06-22');
    const preview = [{
      stableKey: 'preview-1',
      date: '2026-06-23',
      startTime: '21:00',
      endTime: '22:00',
      durationMinutes: 60,
      title: '数学 10ページ',
      field: '数学',
      year: 0,
      estimatedMinutes: 60,
      source: 'weekly_exam_prep' as const,
      approvalStatus: 'unapproved' as const,
      workItemKey: 'work-1',
    }];
    const withPreview = { ...initial, previewCandidates: preview, mode: 'draft_created' as const };
    const pending = {
      conversationId: 'conversation-preview',
      turnId: 'conversation-preview:turn:1',
      requestId: 'conversation-preview:request:1',
      weekStartDate: withPreview.weekStartDate,
      baseRevision: withPreview.revision,
      startedAt: '2026-06-19T00:00:00.000Z',
    };
    const begun = weeklyPlanningReducer(withPreview, {
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'preview-user-1',
        role: 'user',
        content: 'これで追加して',
        createdAt: '2026-06-19T00:00:00.000Z',
      },
    });
    const committed = weeklyPlanningReducer(begun, {
      type: 'commit_turn',
      pending,
      intakeState: { status: 'draft_ready' } as never,
      assistantMessage: assistantMessage('preview-assistant-1', '下のボタンを押してください。'),
      draftCandidates: [],
      preservePreviewCandidates: true,
    });

    expect(committed.previewCandidates).toEqual(preview);
    expect(committed.mode).toBe('draft_created');
  });
'''
anchor = "\n  it('allows session reset to invalidate an active turn', () => {"
assert anchor in text
text = text.replace(anchor, insert + anchor, 1)
path.write_text(text)

path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.test.ts')
text = path.read_text()
insert = r'''

  it('collapses an existing-entity-only semantic shell to a graph no-op', async () => {
    const pipeline = createWeeklyPlanningSemanticPipelineV5(acceptedNormalizer());
    const first = await pipeline.run({
      conversationId: 'conversation-noop',
      turnId: 'turn-create',
      expectedRevision: 0,
      userText: '24日に英単語を30分進めたい',
      schedulerContext,
    });
    const existingTaskId = first.graph.tasks[0]?.id;
    expect(existingTaskId).toBeTruthy();
    const shell = document();
    shell.planningIntent = 'update_plan';
    shell.planningWindow = null;
    shell.tasks = [{
      ...shell.tasks[0],
      localId: 'existing-task-shell',
      existingPublicId: existingTaskId ?? null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英単語',
    }];
    shell.relations = [];
    shell.availabilityDeclarations = [];
    shell.constraintSourceRequests = [];
    shell.uncertainties = [];
    shell.corrections = [];
    shell.decisions = [];

    const second = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(shell),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-noop',
      turnId: 'turn-noop',
      expectedRevision: first.graph.revision,
      userText: 'これで追加して',
      schedulerContext,
    });

    expect(second.canonicalization?.diff).toMatchObject({
      fromRevision: first.graph.revision,
      toRevision: first.graph.revision,
      added: [],
      superseded: [],
      removed: [],
    });
    expect(second.graph).toBe(first.graph);
    expect(second.graph.revision).toBe(first.graph.revision);
  });
'''
anchor = "\n  it('keeps duplicate turns idempotent while compiling the existing graph', async () => {"
assert anchor in text
text = text.replace(anchor, insert + anchor, 1)
path.write_text(text)
