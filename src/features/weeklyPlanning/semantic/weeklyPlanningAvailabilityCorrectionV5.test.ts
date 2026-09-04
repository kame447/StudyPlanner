import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticPublicStateSummaryV5,
} from './weeklyPlanningSemanticPublicStateV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  finalizeWeeklyPlanningSemanticCanonicalizationV5,
} from './weeklyPlanningSemanticCommitV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';
import {
  WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticProviderResponseFormatV5';

function documentWithAvailability(params: {
  localId: string;
  startTime: string;
  sourceText: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [{
      localId: params.localId,
      kind: 'available',
      dateExpression: null,
      namedTimePeriod: null,
      startTime: params.startTime,
      endTime: '23:00',
      recurrenceKind: 'weekly',
      days: ['weekday:wednesday'],
      constraintLevel: 'hard',
      capacityMinutes: null,
      sourceText: params.sourceText,
    }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function initialGraph(): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: empty,
    document: documentWithAvailability({
      localId: 'availability_wednesday_2100_2300',
      startTime: '21:00',
      sourceText: '水曜日は21時から23時まで勉強できます。',
    }),
    context: {
      conversationId: 'conversation-availability-correction',
      turnId: 'turn-1',
      expectedRevision: empty.revision,
    },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join('|'));
  return result.graph;
}

function providerCorrectionResponse(oldPublicId: string): string {
  return JSON.stringify({
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [{
      localId: 'availability_wednesday_2030_2300',
      kind: 'available',
      dateExpression: null,
      namedTimePeriod: null,
      startTime: '20:30',
      endTime: '23:00',
      recurrenceKind: 'weekly',
      days: ['weekday:wednesday'],
      constraintLevel: 'hard',
      capacityMinutes: null,
      sourceText: '水曜日の勉強できる時間を、21時から23時ではなく20時30分から23時に変更してください。',
    }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [{
      localId: 'correction_wednesday_availability',
      target: {
        kind: 'availability_declaration',
        publicId: oldPublicId,
        localId: null,
        mention: '水曜日の21時から23時',
      },
      operation: 'replace',
      replacementLocalId: 'availability_wednesday_2030_2300',
      sourceText: '21時から23時ではなく20時30分から23時に変更',
    }],
    decisions: [],
  });
}

function enumAtProviderCorrectionTarget(): string[] {
  const schema = WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.schema as Record<string, any>;
  return schema.properties.corrections.items.properties.target.properties.kind.enum as string[];
}

function activeAvailabilityIds(graph: WeeklyPlanningFactGraphV5): string[] {
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  return graph.availabilityDeclarations
    .filter((fact) => activeIds.has(fact.id))
    .map((fact) => fact.id);
}

describe('Stable V5 availability corrections', () => {
  it('exposes addressable availability facts and permits the typed provider reference kind', () => {
    const graph = initialGraph();
    const old = graph.availabilityDeclarations[0];
    const summary = createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, graph);

    expect(summary.availabilityDeclarations).toEqual([
      expect.objectContaining({
        publicId: old.id,
        startTime: '21:00',
        endTime: '23:00',
        recurrenceKind: 'weekly',
        days: ['weekday:wednesday'],
      }),
    ]);
    expect(enumAtProviderCorrectionTarget()).toContain('availability_declaration');
    expect(createWeeklyPlanningSemanticMeaningPolicyV5()).toContain(
      'target.kind=availability_declaration',
    );
  });

  it('supersedes the exact old availability when the AI emits an explicit typed correction', () => {
    const graph = initialGraph();
    const old = graph.availabilityDeclarations[0];
    const publicStateSummary = createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, graph);
    const validation = validateWeeklyPlanningSemanticResponseV5(
      providerCorrectionResponse(old.id),
      { publicStateSummary },
    );

    expect(validation.errors).toEqual([]);
    expect(validation.document).not.toBeNull();
    expect((validation.document?.corrections[0]?.target.kind as string)).toBe(
      'availability_declaration',
    );

    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph,
      document: validation.document!,
      context: {
        conversationId: 'conversation-availability-correction',
        turnId: 'turn-2',
        expectedRevision: graph.revision,
      },
    });
    expect(base.status).toBe('applied');

    const committed = finalizeWeeklyPlanningSemanticCanonicalizationV5({
      originalGraph: graph,
      document: validation.document!,
      baseCanonicalization: base,
      contextualAnswer: false,
      questionCode: null,
      operationKeyPrefix: 'conversation-availability-correction:turn-2',
    });
    expect(committed.canonicalization.status).toBe('applied');
    expect(committed.correctionApplication.status).toBe('applied');

    const next = committed.canonicalization.graph;
    const replacement = next.availabilityDeclarations.find((fact) => fact.startTime === '20:30');
    expect(replacement).toBeDefined();
    expect(next.factLifecycles.find((entry) => entry.factId === old.id)).toMatchObject({
      status: 'superseded',
      supersededByFactId: replacement?.id,
    });
    expect(next.factLifecycles.find((entry) => entry.factId === replacement?.id)).toMatchObject({
      status: 'active',
    });
    expect(activeAvailabilityIds(next)).toEqual([replacement?.id]);
    expect(committed.canonicalization.diff?.superseded).toContainEqual({
      kind: 'availability_declaration',
      id: old.id,
    });
  });

  it('keeps an independent added availability active when no correction was emitted', () => {
    const graph = initialGraph();
    const document = documentWithAvailability({
      localId: 'availability_saturday_1000_2300',
      startTime: '10:00',
      sourceText: '土曜日は10時から23時まで勉強できます。',
    });
    document.availabilityDeclarations[0].days = ['weekday:saturday'];

    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph,
      document,
      context: {
        conversationId: 'conversation-availability-correction',
        turnId: 'turn-independent-addition',
        expectedRevision: graph.revision,
      },
    });
    const committed = finalizeWeeklyPlanningSemanticCanonicalizationV5({
      originalGraph: graph,
      document,
      baseCanonicalization: base,
      contextualAnswer: false,
      questionCode: null,
      operationKeyPrefix: 'conversation-availability-correction:turn-independent-addition',
    });

    expect(committed.correctionApplication.status).toBe('not_applicable');
    expect(activeAvailabilityIds(committed.canonicalization.graph)).toHaveLength(2);
  });
});
