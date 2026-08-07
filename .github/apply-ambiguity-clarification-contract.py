from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:160]}')
    p.write_text(text.replace(old, new, 1))


# Semantic interpretation: tolerate only unambiguous spelling noise; do not guess when meaning changes.
path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_once(
    path,
    "    'Every task/component must set existingPublicId: use the exact publicId from publicStateSummary when current userText continues the same accepted entity, otherwise null. Do not create a duplicate task/component merely to add workload, effort, time, recurrence, or detail. If identity is ambiguous, emit uncertainty instead of guessing.',\n",
    "    'Every task/component must set existingPublicId: use the exact publicId from publicStateSummary when current userText continues the same accepted entity, otherwise null. Do not create a duplicate task/component merely to add workload, effort, time, recurrence, or detail. If identity is ambiguous, emit uncertainty instead of guessing.',\n    'Obvious spelling, kana/kanji, speech-input, or OCR noise may be interpreted without clarification only when one reading is clearly supported by current userText and conversation context; keep the original excerpt in sourceText. If two or more plausible readings would change task identity, the target of a quantity, or another planning fact, emit uncertainty and do not create or modify the guessed fact.',\n",
)

# Dialogue rendering: ask about exactly the unclear fragment, without asserting a guessed reading.
path = 'src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts'
replace_once(
    path,
    "    '入力にない具体情報は、例としても補わないでください。',\n",
    "    '入力にない具体情報は、例としても補わないでください。',\n    '誤字や崩れた文でも意味が一意なら自然に理解して構いません。意味が複数通りあり得る場合は推測を事実として言い直さず、曖昧な部分だけを一つ確認してください。',\n",
)
replace_once(
    path,
    "      'undecidedItemsにfieldがwork_breakdownの項目がある場合だけ、その対象の中身を分ける質問をしてください。questionCodeがmissing_schedulable_workの場合は追加の分解を求めず、既に分かっている一つの作業について量・範囲を確認してください。',\n",
    "      'undecidedItemsにfieldがwork_breakdownの項目がある場合だけ、その対象の中身を分ける質問をしてください。questionCodeがmissing_schedulable_workの場合は追加の分解を求めず、既に分かっている一つの作業について量・範囲を確認してください。semantic_uncertaintyの場合はsourceTextとreasonを使い、意味を決め打ちせず、その曖昧さを解消する一つの確認だけをしてください。',\n",
)

# Prompt regression contracts remain generic and scenario-independent.
path = 'src/features/weeklyPlanning/__tests__/weeklyPlanningPromptGeneralizationV5.test.ts'
replace_once(
    path,
    "  it('keeps breakdown and missing-quantity questions as distinct renderer intents', () => {\n",
    "  it('requires ambiguity-safe interpretation without hard-coding typo examples', () => {\n    const prompt = createWeeklyPlanningSemanticSystemPromptV5();\n    expect(prompt).toContain('Obvious spelling, kana/kanji, speech-input, or OCR noise');\n    expect(prompt).toContain('only when one reading is clearly supported');\n    expect(prompt).toContain('two or more plausible readings');\n    expect(prompt).toContain('emit uncertainty and do not create or modify the guessed fact');\n    expect(prompt).not.toContain('数楽ワーク');\n    expect(prompt).not.toContain('英語レボート');\n\n    const dialogue = createWeeklyPlanningStableV5DialoguePrompt({\n      actionId: 'ambiguity-1',\n      currentUserMessage: '入力が少し崩れています',\n      recentConversation: [],\n      planningInformation: {\n        uncertainties: [{\n          id: 'uncertainty-ambiguous',\n          targetFactId: null,\n          field: 'workload_target',\n          reason: 'quantity target has multiple plausible readings',\n          source: { sourceText: 'この部分' },\n        }],\n      },\n      actionKind: 'question',\n      questionCode: 'semantic_uncertainty',\n      requiredLabels: [],\n      fallbackText: '曖昧な部分だけ確認してください。',\n      previewCount: 0,\n    });\n    expect(dialogue.systemPrompt).toContain('意味が一意なら自然に理解');\n    expect(dialogue.systemPrompt).toContain('曖昧な部分だけを一つ確認');\n    expect(dialogue.userPrompt).toContain('意味を決め打ちせず');\n    expect(dialogue.userPrompt).toContain('一つの確認だけ');\n  });\n\n  it('keeps breakdown and missing-quantity questions as distinct renderer intents', () => {\n",
)

# Deterministic fallback wording must not assert an interpretation for semantic uncertainty.
path = 'src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts'
replace_once(
    path,
    "  it('attributes normalization rejection to internal processing and requests one recoverable item', async () => {\n",
    "  it('keeps semantic ambiguity ahead of scheduling and asks only about the unclear fragment', async () => {\n    const ambiguous = document();\n    ambiguous.tasks = [];\n    ambiguous.planningWindow = null;\n    ambiguous.uncertainties = [{\n      localId: 'uncertainty-1',\n      targetLocalId: 'document',\n      field: 'workload_target',\n      reason: 'quantity target has multiple plausible readings',\n      sourceText: '数学のワークが、古典も…20ページくらい',\n    }];\n    normalizeMock.mockResolvedValueOnce(acceptedResult(ambiguous));\n\n    const result = await executeWeeklyPlanningStableV5RuntimeTurn({\n      previousState: undefined,\n      messages: [],\n      userText: '数学のワークが、古典も…20ページくらい',\n      selectedDate: '2026-08-08',\n      userId: 'owner-1',\n      plans: [],\n      scheduleTemplates: [],\n      conversationId: 'conversation-ambiguous-input',\n      traceRequestId: 'request-ambiguous-input',\n    });\n\n    expect(result.state).toMatchObject({\n      status: 'revision_pending',\n      shouldCreateDraft: false,\n      lastQuestionContext: {\n        targetSlot: 'stable_v5:semantic_uncertainty',\n        intent: 'semantic_uncertainty',\n      },\n    });\n    expect(result.message).toContain('数学のワークが、古典も…20ページくらい');\n    expect(result.message).toContain('この部分だけ');\n    expect(result.message).not.toContain('数学を20ページ');\n    expect(result.message).not.toContain('古典を20ページ');\n    expect(result.draftCandidates).toEqual([]);\n  });\n\n  it('attributes normalization rejection to internal processing and requests one recoverable item', async () => {\n",
)
