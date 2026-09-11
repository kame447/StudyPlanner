import { describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  createWeeklyPlanningRegisteredMaterialContextV5,
} from '../personalization/weeklyPlanningRegisteredMaterialRuntimeV5';
import {
  deriveWeeklyPlanningSessionPolicyV5,
  DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
} from '../semantic/weeklyPlanningStableV5ExecutionProfile';
import { splitWeeklyPlanningSessionMinutesV5 } from '../semantic/weeklyPlanningStableV5SessionSplitter';
import { createEmptyWeeklyPlanningFactGraph } from '../semantic/weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from '../semantic/weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5 } from '../semantic/weeklyPlanningSchedulerWorkDistributionV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from '../semantic/weeklyPlanningSemanticPromptAssemblyV5';

describe('Issue #152 P1 numeric sibling and splitter boundaries', () => {
  it('documents splitter limitation: totals requiring more than 512 chunks return no chunks (scheduler-owned; see Luna B V13)', () => {
    // The caller may preserve the unsplit item; the splitter alone is not sufficient evidence of silent loss.
    const policy = deriveWeeklyPlanningSessionPolicyV5({
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
      absoluteMaxSessionMinutes: 120,
      minimumSessionMinutes: 30,
    });
    const result = splitWeeklyPlanningSessionMinutesV5({
      totalMinutes: 120 * 513,
      policy,
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
    });
    expect(result).toEqual([]);
  });

  it('keeps non-finite registered-material numeric fields out of prompt context', () => {
    const material: StudyMaterial = {
      id: 'material-152',
      userId: 'owner-152',
      name: '教材',
      subjectId: 'subject-152',
      subjectName: '数学',
      aliases: ['数学教材'],
      status: 'active',
      paceEnabled: true,
      progressUnit: 'problem',
      totalUnits: Number.NaN,
      currentUnit: Number.POSITIVE_INFINITY,
      targetDate: undefined,
      estimatedMinutesPerUnit: Number.NaN,
      maxUnitsPerDay: Number.POSITIVE_INFINITY,
      coverImageUrl: undefined,
      coverImageDataUrl: undefined,
      catalogEntryId: 'catalog-152',
      catalogTitle: '教材カタログ名',
      catalogIsbn13: undefined,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    };
    const [context] = createWeeklyPlanningRegisteredMaterialContextV5({
      ownerId: 'owner-152',
      materials: [material],
      userText: '数学教材を進める',
    });
    expect(context).toEqual(expect.objectContaining({
      catalogTitle: '教材カタログ名',
      aliases: ['数学教材'],
      totalUnits: null,
      currentUnit: null,
      estimatedMinutesPerUnit: null,
      maxUnitsPerDay: null,
      remainingUnits: null,
    }));
  });

  it('keeps registered catalog strings in the user data payload, not semantic system policy', () => {
    const messages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '教材カタログ名を進めたい',
      publicStateSummary: {
        registeredMaterials: [{ name: '教材', catalogTitle: '教材カタログ名', aliases: ['数学教材'] }],
      },
    });
    expect(messages[0]?.content).not.toContain('教材カタログ名');
    expect(messages.find((message) => message.role === 'user')?.content).toContain('教材カタログ名');
  });

  it('documents caller behavior: a cap-exceeding work item is preserved unsplit rather than silently dropped', () => {
    const source = {
      conversationId: 'conversation-152',
      turnId: 'turn-152',
      semanticLocalId: 'local-152',
      sourceText: '1026時間',
      origin: 'user' as const,
    };
    const graph = createEmptyWeeklyPlanningFactGraph();
    graph.revision = 1;
    graph.tasks = [{ id: 'task-152', category: 'study', title: '長時間課題', source, createdRevision: 1 }];
    graph.workloads = [{
      id: 'workload-152', taskId: 'task-152', componentId: null, quantityRole: 'target',
      amount: 1026, unitCode: 'hour', unitLabel: '時間', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1,
    }];
    const compiled = compileGenericPlanningWorkItems(graph);
    const distributed = distributeGenericSchedulerWorkItemsV5({
      graph,
      items: compiled.items,
      startDate: '2026-09-11',
      endDate: '2026-09-17',
    });
    expect(distributed).toHaveLength(1);
    expect(distributed[0]?.estimatedMinutes).toBe(1026 * 60);
  });
});

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

describe('Issue #152 P1 no-op boundary', () => {
  it('documents scripted normalizer no-op output without mutating its typed public state input', async () => {
    const publicStateSummary = {
      tasks: [{ publicId: 'task-152', title: '数学' }],
      userPlanningContext: [{ id: 'memory-152', kind: 'concern', label: '数学', value: '苦手' }],
    };
    const before = structuredClone(publicStateSummary);
    const client = {
      async createChatCompletion() {
        return JSON.stringify(emptyDocument());
      },
    } as never;
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '今日は計画を確認するだけ',
      publicStateSummary,
      traceRequestId: 'v16-noop',
    });
    expect(result.status).toBe('accepted');
    expect(result.document?.tasks).toEqual([]);
    expect(result.document?.userContextFacts).toEqual([]);
    expect(publicStateSummary).toEqual(before);
  });
});
