import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  applyWeeklyPlanningStableV5ContextualAnswer,
  evaluateWeeklyPlanningStableV5ContextualAnswer,
} from './weeklyPlanningStableV5ContextualAnswer';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '夏休みの課題が残っている',
  origin: 'user' as const,
};

function graphWithPendingBreakdown(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks: [{
      id: 'task-existing',
      category: 'study',
      title: '夏休みの課題を進める',
      source,
      createdRevision: 1,
    }],
    uncertainties: [{
      id: 'uncertainty-breakdown',
      targetFactId: 'task-existing',
      field: 'work_breakdown',
      reason: '課題の内訳が未確定',
      source,
      createdRevision: 2,
    }],
    factLifecycles: [
      {
        factId: 'task-existing',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'uncertainty-breakdown',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function breakdownDocument(params: {
  retainedUncertaintyField: string;
  retainedUncertaintyTargetLocalId: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-current',
      existingPublicId: 'task-existing',
      decompositionStatus: 'decomposed',
      category: 'study',
      title: '夏休みの課題を進める',
      study: {
        purpose: 'homework',
        contextLabel: '夏休みの課題',
        components: [
          {
            localId: 'component-math',
            existingPublicId: null,
            parentLocalId: null,
            role: 'material',
            label: '数学のワーク',
            workloads: [],
            durableContextSignals: [],
            sourceText: '数学のワーク',
          },
          {
            localId: 'component-classics',
            existingPublicId: null,
            parentLocalId: null,
            role: 'material',
            label: '古典の課題',
            workloads: [],
            durableContextSignals: [],
            sourceText: '古典の課題',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '数学のワークと古典の課題が残ってます。',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [{
      localId: 'uncertainty-current',
      targetLocalId: params.retainedUncertaintyTargetLocalId,
      field: params.retainedUncertaintyField,
      reason: '追加で未確定な情報がある',
      sourceText: '数学のワークの方が量は多いです。',
    }],
    corrections: [],
    decisions: [],
  };
}

const pendingQuestion = {
  actionId: 'stable-v5:question-1',
  questionCode: 'semantic_uncertainty' as const,
  targetFactId: 'uncertainty-breakdown',
  graphRevision: 2,
};

describe('Stable V5 semantic-uncertainty contextual answer', () => {
  it('closes the exact pending uncertainty while preserving a new child uncertainty', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graphWithPendingBreakdown(),
      document: breakdownDocument({
        retainedUncertaintyField: 'relative_workload_amount',
        retainedUncertaintyTargetLocalId: 'component-math',
      }),
      pendingQuestion,
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 2,
      userText: '数学のワークと古典の課題が残ってます。数学のワークの方が量は多いです。',
    });

    expect(result?.status).toBe('applied');
    expect(result?.localToFactId).toMatchObject({
      'task-current': expect.any(String),
      'component-math': expect.any(String),
      'component-classics': expect.any(String),
      'uncertainty-current': expect.any(String),
    });
    expect(result?.graph.uncertainties).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'relative_workload_amount',
        targetFactId: result?.localToFactId['component-math'],
      }),
    ]));
    expect(result?.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factId: 'uncertainty-breakdown',
        status: 'removed',
      }),
    ]));
  });

  it('does not close the pending uncertainty when the same field remains on the same exact target', () => {
    const evaluation = evaluateWeeklyPlanningStableV5ContextualAnswer({
      graph: graphWithPendingBreakdown(),
      document: breakdownDocument({
        retainedUncertaintyField: 'work_breakdown',
        retainedUncertaintyTargetLocalId: 'task-current',
      }),
      pendingQuestion,
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 2,
      userText: '内訳はまだ分かりません。',
    });

    expect(evaluation).toMatchObject({
      status: 'incompatible',
      reason: 'uncertainty_not_resolved',
      targetFactId: 'uncertainty-breakdown',
    });
  });
});
