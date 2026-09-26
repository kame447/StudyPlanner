import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';

const turnTwoUserText = '1問10分くらいです。それと英単語200語も忘れずに入れてください。英単語は20語で15分くらいです。';
const mathTaskId = 'wpf_task_1j9a97z1idf3mb';
const mathWorkloadId = 'wpf_workload_15rxub746yobr';
const source = {
  conversationId: 'issue152-postfix-completion-20260926-2',
  turnId: 'issue152-postfix-completion-20260926-2:request:1',
  origin: 'user' as const,
};

function committedGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: [`${source.conversationId}:${source.turnId}`],
    tasks: [{
      id: mathTaskId, category: 'study', title: '数学の問題集を進める',
      source: { ...source, semanticLocalId: 'task-1', sourceText: '数学の問題集を30問進めたいです' },
      createdRevision: 1,
    }],
    workloads: [{
      id: mathWorkloadId, taskId: mathTaskId, componentId: null,
      quantityRole: 'target', amount: 30, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      source: { ...source, semanticLocalId: 'workload-1', sourceText: '数学の問題集を30問' },
      createdRevision: 1,
    }],
    factLifecycles: [mathTaskId, mathWorkloadId].map((factId) => ({
      factId, status: 'active' as const, createdRevision: 1,
      terminalRevision: null, supersededByFactId: null,
    })),
  };
}

function repairDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task_math_existing', existingPublicId: mathTaskId,
      decompositionStatus: 'atomic', category: 'study', title: '数学の問題集を進める',
      study: null,
      workloads: [{
        localId: 'workload_math_target_existing', quantityRole: 'target', amount: 30,
        unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '数学の問題集を30問',
      }],
      effortEstimates: [{
        localId: 'effort_math_per_problem', targetLocalId: 'workload_math_target_existing',
        kind: 'duration_per_unit', minutes: 10, unitCode: 'problem', precision: 'approximate',
        sourceText: '1問10分くらいです',
      }],
      temporalConstraints: [], recurrence: [], durableContextSignals: [],
      sourceText: '1問10分くらいです',
    }, {
      localId: 'task_english_vocabulary', existingPublicId: null,
      decompositionStatus: 'atomic', category: 'study', title: '英単語を覚える',
      study: { purpose: 'self_study', activityKind: 'memorization_retrieval', contextLabel: null, components: [] },
      workloads: [{
        localId: 'workload_english_vocabulary_target', quantityRole: 'target', amount: 200,
        unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '英単語200語',
      }],
      effortEstimates: [{
        localId: 'effort_english_vocabulary_per_word',
        targetLocalId: 'workload_english_vocabulary_target',
        kind: 'duration_per_unit', minutes: 0.75, unitCode: 'word', precision: 'approximate',
        sourceText: '英単語は20語で15分くらいです',
      }],
      temporalConstraints: [], recurrence: [], durableContextSignals: [],
      sourceText: '英単語200語も忘れずに入れてください。英単語は20語で15分くらいです',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
}

function validationErrors(
  document: WeeklyPlanningSemanticDocumentV5,
  graph: WeeklyPlanningFactGraphV5 | undefined = committedGraph(),
  publicStateSummary?: Record<string, unknown>,
): string[] {
  return validateWeeklyPlanningCurrentTurnProvenanceV5({
    document, currentUserText: turnTwoUserText, committedGraph: graph, publicStateSummary,
  });
}

function scriptedClient(responses: string[]): {
  client: OpenAiCompatibleClient;
  calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]>;
} {
  const calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  let index = 0;
  return {
    calls,
    client: {
      async createChatCompletion(request) {
        calls.push(request);
        const response = responses[index++];
        if (response === undefined) throw new Error('scripted response exhausted');
        return response;
      },
    },
  };
}

const schedulerContext = {
  ownerId: 'owner-152', currentDate: '2026-09-26', timeZone: 'Asia/Tokyo',
  planningStartDate: '2026-09-28', planningEndDate: '2026-10-04',
};

describe('Issue #152 committed workload restatement provenance', () => {
  it('accepts the observed Real turn 2 repair through validation and commit without duplicating math', async () => {
    const repaired = repairDocument();
    const initial = repairDocument();
    initial.tasks[0]!.workloads = [];
    initial.tasks[0]!.effortEstimates[0]!.targetLocalId = mathWorkloadId;
    const scripted = scriptedClient([JSON.stringify(initial), JSON.stringify(repaired)]);
    const result = await createWeeklyPlanningSemanticPipelineV5(
      createWeeklyPlanningSemanticNormalizerV5(scripted.client),
    ).run({
      conversationId: source.conversationId,
      turnId: `${source.conversationId}:request:2`, expectedRevision: 1,
      graph: committedGraph(), userText: turnTwoUserText, schedulerContext,
    });

    expect(result.normalization.status).toBe('accepted');
    expect(result.normalization.diagnostics.repairAttempted).toBe(true);
    expect(result.normalization.diagnostics.validationErrors).toContain(
      'document.tasks[0].effortEstimates[0].targetLocalId',
    );
    expect(result.canonicalization?.status).toBe('applied');
    expect(result.graph.revision).toBe(2);
    expect(result.graph.workloads).toHaveLength(2);
    expect(result.graph.workloads.filter((fact) => fact.taskId === mathTaskId)).toHaveLength(1);
    expect(result.graph.workloads.find((fact) => fact.id === mathWorkloadId)?.amount).toBe(30);
    expect(result.graph.effortEstimates.some((fact) => fact.targetFactId === mathWorkloadId
      && fact.minutes === 10)).toBe(true);
    expect(result.graph.workloads.some((fact) => fact.amount === 200 && fact.unitCode === 'word')).toBe(true);
    expect(scripted.calls).toHaveLength(2);
    expect(JSON.stringify(scripted.calls)).not.toContain('committedGraph');
  });

  it('keeps an isolated exact restatement at the same revision and workload count', async () => {
    const document = repairDocument();
    document.tasks = [document.tasks[0]!];
    document.tasks[0]!.effortEstimates = [];
    const scripted = scriptedClient([JSON.stringify(document)]);
    const result = await createWeeklyPlanningSemanticPipelineV5(
      createWeeklyPlanningSemanticNormalizerV5(scripted.client),
    ).run({
      conversationId: source.conversationId,
      turnId: `${source.conversationId}:request:2`, expectedRevision: 1,
      graph: committedGraph(), userText: turnTwoUserText, schedulerContext,
    });
    expect(result.normalization.status).toBe('accepted');
    expect(result.canonicalization?.status).toBe('applied');
    expect(result.graph.revision).toBe(1);
    expect(result.graph.workloads).toHaveLength(1);
    expect(result.canonicalization?.diff?.added).toEqual([]);
  });

  it('requires the same typed value, active entity, and committed user-channel evidence', () => {
    const document = repairDocument();
    expect(validationErrors(document)).toEqual([]);
    const path = 'document.tasks[0].workloads[0].sourceText:not-grounded-in-current-user-text';

    const changed = structuredClone(document);
    changed.tasks[0]!.workloads[0]!.amount = 31;
    expect(validationErrors(changed)).toContain(path);
    changed.tasks[0]!.workloads[0]!.sourceText = '31問に変更';
    changed.tasks[0]!.effortEstimates = [];
    changed.tasks = [changed.tasks[0]!];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: changed, currentUserText: '31問に変更', committedGraph: committedGraph(),
    })).toEqual([]);

    const unrelatedSource = structuredClone(document);
    unrelatedSource.tasks[0]!.workloads[0]!.sourceText = '保存済みの数学課題30問';
    expect(validationErrors(unrelatedSource)).toContain(path);

    const supplemental = committedGraph();
    supplemental.workloads[0]!.source.provenanceChannel = 'supplemental';
    expect(validationErrors(document, supplemental)).toContain(path);

    const inactive = committedGraph();
    inactive.factLifecycles[1]!.status = 'removed';
    expect(validationErrors(document, inactive)).toContain(path);

    const noCommittedFact = committedGraph();
    noCommittedFact.workloads = [];
    noCommittedFact.factLifecycles = noCommittedFact.factLifecycles.slice(0, 1);
    expect(validationErrors(document, noCommittedFact, {
      tasks: [{ publicId: mathTaskId, title: '数学の問題集を進める' }],
      workloads: [{ publicId: mathWorkloadId, taskPublicId: mathTaskId, amount: 30 }],
      userPlanningContext: [{ label: '数学の問題集を30問', value: '30問' }],
      lastAssistantMessage: '数学の問題集を30問',
    })).toContain(path);
  });

  it('binds nested workload restatements only to the same active component', () => {
    const graph = committedGraph();
    graph.components = [{
      id: 'component-math', taskId: mathTaskId, parentComponentId: null,
      role: 'material', label: '問題集',
      source: { ...source, semanticLocalId: 'component-1', sourceText: '数学の問題集' },
      createdRevision: 1,
    }];
    graph.workloads[0]!.componentId = 'component-math';
    graph.factLifecycles.push({
      factId: 'component-math', status: 'active', createdRevision: 1,
      terminalRevision: null, supersededByFactId: null,
    });
    const document = repairDocument();
    const task = document.tasks[0]!;
    task.study = {
      purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null,
      components: [{
        localId: 'component-local', existingPublicId: 'component-math', parentLocalId: null,
        role: 'material', label: '問題集', workloads: [task.workloads[0]!],
        sourceText: '1問10分くらいです',
      }],
    };
    task.workloads = [];
    expect(validationErrors(document, graph)).toEqual([]);
    task.study.components[0]!.existingPublicId = 'different-component';
    expect(validationErrors(document, graph)).toContain(
      'document.tasks[0].study.components[0].workloads[0].sourceText:not-grounded-in-current-user-text',
    );
  });
});
