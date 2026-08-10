import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';
import {
  applyWeeklyPlanningExistingEntityBindingsV5,
} from './weeklyPlanningExistingEntityBindingApplicationV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
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

describe('Stable V5 cross-turn entity binding', () => {
  it('repairs a duplicate-container delta and missing daily recurrence in one AI repair', async () => {
    const invalid = JSON.stringify({
      ...baseDocument(),
      tasks: [{
        localId: 'task-local',
        existingPublicId: null,
        category: 'study',
        title: '模試の勉強',
        study: {
          purpose: 'exam',
          contextLabel: '模試',
          components: [{
            localId: 'component-local',
            existingPublicId: null,
            parentLocalId: null,
            role: 'subject',
            label: '数学',
            workloads: [{
              localId: 'workload-local',
              quantityRole: 'target',
              amount: 2,
              unitCode: 'hour',
              unitLabel: '時間',
              rangeStart: null,
              rangeEnd: null,
              perOccurrence: true,
              periodExpression: 'daily',
              sourceText: '毎日2時間くらい',
            }],
            durableContextSignals: [],
            sourceText: '数学を中心に、毎日2時間くらい',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText: '模試の方は数学を中心に、毎日2時間くらい',
      }],
    });
    const repaired = JSON.stringify({
      ...baseDocument(),
      tasks: [{
        localId: 'task-local',
        existingPublicId: 'task-public',
        category: 'study',
        title: '模試の勉強',
        study: {
          purpose: 'exam',
          contextLabel: '模試',
          components: [{
            localId: 'component-local',
            existingPublicId: 'component-public',
            parentLocalId: null,
            role: 'subject',
            label: '数学',
            workloads: [{
              localId: 'workload-local',
              quantityRole: 'target',
              amount: 2,
              unitCode: 'hour',
              unitLabel: '時間',
              rangeStart: null,
              rangeEnd: null,
              perOccurrence: true,
              periodExpression: 'daily',
              sourceText: '毎日2時間くらい',
            }],
            durableContextSignals: [],
            sourceText: '数学を中心に、毎日2時間くらい',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [{
          localId: 'recurrence-local',
          targetLocalId: 'component-local',
          kind: 'daily',
          count: null,
          days: [],
          sourceText: '毎日2時間くらい',
        }],
        durableContextSignals: [],
        sourceText: '模試の方は数学を中心に、毎日2時間くらい',
      }],
    });
    const responses = [invalid, repaired];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。',
      publicStateSummary: {
        tasks: [{ publicId: 'task-public', category: 'study', title: '模試の勉強' }],
        components: [{
          publicId: 'component-public',
          taskPublicId: 'task-public',
          role: 'subject',
          label: '数学',
        }],
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    expect(result.document?.tasks[0]).toMatchObject({ existingPublicId: 'task-public' });
    expect(result.document?.tasks[0]?.study?.components[0]).toMatchObject({
      existingPublicId: 'component-public',
    });
    expect(result.document?.tasks[0]?.recurrence).toEqual([
      expect.objectContaining({ kind: 'daily', targetLocalId: 'component-local' }),
    ]);
  });

  it('requires matching recurrence when structured workload explicitly says daily', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-local',
        existingPublicId: null,
        category: 'study',
        title: '英語',
        study: null,
        workloads: [{
          localId: 'workload-local',
          quantityRole: 'target',
          amount: 1,
          unitCode: 'hour',
          unitLabel: '時間',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: true,
          periodExpression: 'daily',
          sourceText: '毎日1時間',
        }],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText: '英語を毎日1時間',
      }],
    };
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document)).toEqual([
      'document.tasks[0].workloads[0]:explicit-recurrence-missing:expected=daily:target=task-local',
    ]);
  });

  it('rebases temporary task/component containers and keeps only new child facts', () => {
    const originalGraph: WeeklyPlanningFactGraphV5 = {
      version: 'weekly-planning-fact-graph-v5',
      revision: 1,
      appliedTurnKeys: ['c:t1'],
      appliedLifecycleOperationKeys: [],
      factLifecycles: [
        { factId: 'task-public', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
        { factId: 'component-public', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      ],
      planningWindows: [],
      tasks: [{
        id: 'task-public', category: 'study', title: '模試の勉強',
        source: { conversationId: 'c', turnId: 't1', semanticLocalId: 'old-task', sourceText: '模試', origin: 'user' },
        createdRevision: 1,
      }],
      studyContexts: [],
      components: [{
        id: 'component-public', taskId: 'task-public', parentComponentId: null, role: 'subject', label: '数学',
        source: { conversationId: 'c', turnId: 't1', semanticLocalId: 'old-component', sourceText: '数学', origin: 'user' },
        createdRevision: 1,
      }],
      workloads: [], effortEstimates: [], temporalConstraints: [], taskDateRules: [], recurrences: [], relations: [], uncertainties: [], correctionIntents: [], decisionIntents: [], availabilityDeclarations: [], constraintSourceRequests: [],
    };
    const document: WeeklyPlanningSemanticDocumentV5 = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-local', existingPublicId: 'task-public', category: 'study', title: '模試の勉強',
        study: { purpose: 'exam', contextLabel: '模試', components: [{
          localId: 'component-local', existingPublicId: 'component-public', parentLocalId: null, role: 'subject', label: '数学',
          workloads: [], durableContextSignals: [], sourceText: '数学を中心に',
        }] },
        workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '模試の方は数学を中心に',
      }],
    };
    const graph: WeeklyPlanningFactGraphV5 = {
      ...originalGraph,
      revision: 2,
      appliedTurnKeys: ['c:t1', 'c:t2'],
      factLifecycles: [
        ...originalGraph.factLifecycles,
        { factId: 'task-temp', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
        { factId: 'study-temp', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
        { factId: 'component-temp', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
        { factId: 'workload-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
        { factId: 'recurrence-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
      ],
      tasks: [...originalGraph.tasks, {
        id: 'task-temp', category: 'study', title: '模試の勉強',
        source: { conversationId: 'c', turnId: 't2', semanticLocalId: 'task-local', sourceText: '模試の方', origin: 'user' }, createdRevision: 2,
      }],
      studyContexts: [{
        id: 'study-temp', taskId: 'task-temp', purpose: 'exam', contextLabel: '模試',
        source: { conversationId: 'c', turnId: 't2', semanticLocalId: 'task-local', sourceText: '模試の方', origin: 'user' }, createdRevision: 2,
      }],
      components: [...originalGraph.components, {
        id: 'component-temp', taskId: 'task-temp', parentComponentId: null, role: 'subject', label: '数学',
        source: { conversationId: 'c', turnId: 't2', semanticLocalId: 'component-local', sourceText: '数学', origin: 'user' }, createdRevision: 2,
      }],
      workloads: [{
        id: 'workload-new', taskId: 'task-temp', componentId: 'component-temp', quantityRole: 'target', amount: 2,
        unitCode: 'hour', unitLabel: '時間', rangeStart: null, rangeEnd: null, perOccurrence: true, periodExpression: 'daily',
        source: { conversationId: 'c', turnId: 't2', semanticLocalId: 'workload-local', sourceText: '毎日2時間', origin: 'user' }, createdRevision: 2,
      }],
      recurrences: [{
        id: 'recurrence-new', taskId: 'task-temp', targetFactId: 'component-temp', kind: 'daily', count: null, days: [],
        source: { conversationId: 'c', turnId: 't2', semanticLocalId: 'recurrence-local', sourceText: '毎日2時間', origin: 'user' }, createdRevision: 2,
      }],
    };
    const canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5 = {
      status: 'applied', graph,
      diff: { fromRevision: 1, toRevision: 2, added: [
        { kind: 'task', id: 'task-temp' }, { kind: 'study_context', id: 'study-temp' }, { kind: 'component', id: 'component-temp' },
        { kind: 'workload', id: 'workload-new' }, { kind: 'recurrence', id: 'recurrence-new' },
      ], superseded: [], removed: [] },
      errors: [],
      localToFactId: { 'task-local': 'task-temp', 'component-local': 'component-temp', 'workload-local': 'workload-new', 'recurrence-local': 'recurrence-new' },
    };

    const result = applyWeeklyPlanningExistingEntityBindingsV5({ originalGraph, document, canonicalization });
    expect(result.status).toBe('applied');
    expect(result.canonicalization.graph.tasks).toHaveLength(1);
    expect(result.canonicalization.graph.components).toHaveLength(1);
    expect(result.canonicalization.graph.studyContexts).toEqual([]);
    expect(result.canonicalization.graph.workloads[0]).toMatchObject({ taskId: 'task-public', componentId: 'component-public' });
    expect(result.canonicalization.graph.recurrences[0]).toMatchObject({ taskId: 'task-public', targetFactId: 'component-public' });
    expect(result.canonicalization.localToFactId).toMatchObject({ 'task-local': 'task-public', 'component-local': 'component-public' });
    expect(result.canonicalization.diff?.added.map((entry) => entry.kind)).toEqual(['workload', 'recurrence']);
  });
});
