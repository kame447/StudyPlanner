import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  finalizeWeeklyPlanningSemanticCanonicalizationV5,
} from './weeklyPlanningSemanticCommitV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '教材の章立てに沿って進めたい',
  origin: 'user' as const,
};

function graphWithTwoPendingBreakdowns(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    tasks: [
      {
        id: 'task-physics',
        category: 'study',
        title: '物理を進める',
        source,
        createdRevision: 1,
      },
      {
        id: 'task-chemistry',
        category: 'study',
        title: '化学を進める',
        source,
        createdRevision: 1,
      },
    ],
    uncertainties: [
      {
        id: 'uncertainty-physics',
        targetFactId: 'task-physics',
        field: 'work_breakdown',
        reason: '物理の内訳が未確定',
        source,
        createdRevision: 2,
      },
      {
        id: 'uncertainty-chemistry',
        targetFactId: 'task-chemistry',
        field: 'work_breakdown',
        reason: '化学の内訳が未確定',
        source,
        createdRevision: 2,
      },
    ],
    factLifecycles: [
      ...['task-physics', 'task-chemistry'].map((factId) => ({
        factId,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      })),
      ...['uncertainty-physics', 'uncertainty-chemistry'].map((factId) => ({
        factId,
        status: 'active' as const,
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      })),
    ],
  };
}

function resolvedTask(params: {
  localId: string;
  existingPublicId: string;
  title: string;
  componentLocalId: string;
  componentLabel: string;
}): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  return {
    localId: params.localId,
    existingPublicId: params.existingPublicId,
    decompositionStatus: 'decomposed',
    category: 'study',
    title: params.title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [{
        localId: params.componentLocalId,
        existingPublicId: null,
        parentLocalId: null,
        role: 'chapter',
        label: params.componentLabel,
        workloads: [],
        durableContextSignals: [],
        sourceText: params.componentLabel,
      }],
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.title,
  };
}

function resolvedDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [
      resolvedTask({
        localId: 'task-physics-local',
        existingPublicId: 'task-physics',
        title: '物理を進める',
        componentLocalId: 'component-physics-chapters',
        componentLabel: '良問の風の章立て',
      }),
      resolvedTask({
        localId: 'task-chemistry-local',
        existingPublicId: 'task-chemistry',
        title: '化学を進める',
        componentLocalId: 'component-chemistry-chapters',
        componentLabel: '重要問題集の章立て',
      }),
    ],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 semantic commit resolved work-breakdown cleanup', () => {
  it('closes every active work_breakdown uncertainty resolved by the same multi-task turn', () => {
    const graph = graphWithTwoPendingBreakdowns();
    const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({
      originalGraph: graph,
      document: resolvedDocument(),
      baseCanonicalization: {
        status: 'applied',
        graph,
        diff: {
          fromRevision: 2,
          toRevision: 2,
          added: [],
          superseded: [],
          removed: [],
        },
        errors: [],
        localToFactId: {},
      },
      contextualAnswer: true,
      questionCode: 'semantic_uncertainty',
      operationKeyPrefix: 'conversation-1:turn-2',
    });

    expect(result.canonicalization.status).toBe('applied');
    expect(result.canonicalization.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factId: 'uncertainty-physics',
        status: 'removed',
      }),
      expect.objectContaining({
        factId: 'uncertainty-chemistry',
        status: 'removed',
      }),
    ]));
    expect(result.canonicalization.diff?.removed).toEqual(expect.arrayContaining([
      { kind: 'uncertainty', id: 'uncertainty-physics' },
      { kind: 'uncertainty', id: 'uncertainty-chemistry' },
    ]));
  });
});
