import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningCurrentTurnProvenanceV5 } from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function taskWithWorkload(params: {
  title: string;
  sourceText: string;
  workloadSourceText: string;
  workloadAmount?: number;
}): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  return {
    localId: 'task-1',
    decompositionStatus: 'atomic',
    category: 'study',
    title: params.title,
    study: null,
    workloads: [{
      localId: 'workload-1',
      quantityRole: 'target',
      amount: params.workloadAmount ?? 20,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: params.workloadSourceText,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.sourceText,
  };
}

describe('Issue #152 V03 provenance validator characterizations', () => {
  it('documents exposure: a one-character source substring grounds a value (semantic-owned; see Luna B V03)', () => {
    // A minimum evidence length would be a lexical/length heuristic; characterize the current semantic-owned boundary instead.
    const decisionDocument = emptyDocument();
    decisionDocument.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: 'x',
      value: null,
      dateExpression: null,
      sourceText: 'x',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: decisionDocument,
      currentUserText: 'x',
    })).toEqual([]);

    const amountDocument = emptyDocument();
    amountDocument.tasks = [taskWithWorkload({
      title: '数学',
      sourceText: 'x',
      workloadSourceText: 'x',
      workloadAmount: 10_000,
    })];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: amountDocument,
      currentUserText: 'x',
    })).toEqual([]);
  });

  it.fails('rejects a zero-width-space copy of a stored value', () => {
    // Issue #152 V03 reproduced: the stored-copy normalizer does not remove U+200B.
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1', kind: 'concern', label: '別ラベル', value: 'S\u200bECRET',
      dateExpression: null, sourceText: '今日は数学を進める',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日は数学を進める',
      publicStateSummary: { userPlanningContext: [{ id: 'stored-1', label: '学習', value: 'SECRET' }] },
    })).toContain('document.userContextFacts[0].value:copied-from-stored-context-without-current-mention');
  });

  it('documents exposure: a suffix/partial stored copy is not treated as exact copy (semantic-owned; see Luna B V03)', () => {
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1', kind: 'concern', label: '別ラベル', value: 'SECRET-suffix',
      dateExpression: null, sourceText: '今日は数学を進める',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日は数学を進める',
      publicStateSummary: { userPlanningContext: [{ id: 'stored-1', label: '学習', value: 'SECRET' }] },
    })).toEqual([]);
  });

  it('rejects an exact stored copy without current-turn mention', () => {
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
        label: '別ラベル',
      value: 'SECRET',
      dateExpression: null,
      sourceText: '今日は数学を進める',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日は数学を進める',
      publicStateSummary: { userPlanningContext: [{ id: 'stored-1', label: '学習', value: 'SECRET' }] },
    })).toContain('document.userContextFacts[0].value:copied-from-stored-context-without-current-mention');
  });

  it('documents exposure: registered material and numeric sibling strings are outside the stored-string set (semantic-owned; see Luna B V03)', () => {
    // Resolving a registered material can be legitimate; ownership of these additional carriers remains a Luna B decision.
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: '教材',
      value: 'Catalog Secret',
      dateExpression: null,
      sourceText: '今日は数学を進める',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日は数学を進める',
      publicStateSummary: {
        registeredMaterials: [{ name: '教材', catalogTitle: 'Catalog Secret', aliases: ['Alias Secret'] }],
        workloads: [{ unitLabel: 'Catalog Secret', periodExpression: '毎週' }],
        groundingRecords: [{ sourceExpression: 'Grounding Secret' }],
      },
    })).toEqual([]);
  });

  it('documents exposure: an assistant-message fragment is outside the stored-string set (semantic-owned; see Luna B V03)', () => {
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: '履歴',
      value: '過去の断片',
      dateExpression: null,
      sourceText: '今日の数学',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日の数学',
      publicStateSummary: { lastAssistantMessage: '現在の説明に過去の断片が含まれる' },
    })).toEqual([]);
  });

  it('documents fail-open when currentUserText is omitted at the semantic response boundary', () => {
    const document = emptyDocument();
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({ document })).toEqual([]);
  });
});

describe('Issue #152 V03 provenance caller inventory', () => {
  it.fails.each([
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticGenericRepairRouteV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNoOpCompletenessRetryV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticFocusedRepairRoutesV5.ts',
  ])('passes currentUserText through the production call site: %s', (path) => {
    // Issue #152 V03 reproduced: repair and no-op retry callers validate without currentUserText; only the final normalizer guard restores coverage.
    const source = readFileSync(path, 'utf8');
    expect(source).toMatch(/validateWeeklyPlanningSemanticResponseV5\([\s\S]{0,700}currentUserText/);
  });
});

describe('Issue #152 V04 semantic repair/provider-call budget', () => {
  it.each([
    { name: 'invalid→invalid', responses: ['{"not":"the semantic schema"}', '{"not":"the semantic schema"}'], expectedStatus: 'rejected' },
    { name: 'invalid→valid', responses: ['{"not":"the semantic schema"}', JSON.stringify(emptyDocument())], expectedStatus: 'accepted' },
  ] as const)('counts one semantic repair after $name responses', async (testCase) => {
    const invalid = '{"not":"the semantic schema"}';
    let calls = 0;
    const client = {
      async createChatCompletion() {
        const response = testCase.responses[calls] ?? invalid;
        calls += 1;
        return response;
      },
    } as never;
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '数学を進めたい',
      traceRequestId: `v04-${testCase.name}`,
    });
    expect(result.status).toBe(testCase.expectedStatus);
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(calls).toBe(2);
  });
});
