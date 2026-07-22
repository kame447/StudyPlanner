import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import {
  parseWeeklyPlanningSemanticDocumentV2,
  validateWeeklyPlanningSemanticValueV2,
} from './weeklyPlanningSemanticValidatorV2';

function createDocument(): WeeklyPlanningSemanticDocumentV2 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-dinner',
        category: 'non_study',
        title: '夕食',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'constraint-dinner',
            targetLocalId: 'task-dinner',
            kind: 'fixed_interval',
            constraintLevel: 'hard',
            dateExpression: null,
            startTime: '18:00',
            endTime: '19:00',
            precision: 'exact',
            sourceText: '18時から19時まで夕食',
          },
        ],
        recurrence: [],
        sourceText: '18時から19時まで夕食',
      },
    ],
    relations: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    availabilityDeclarations: [
      {
        localId: 'availability-weekdays',
        kind: 'unavailable',
        dateExpression: null,
        startTime: null,
        endTime: '18:00',
        recurrenceKind: 'weekdays',
        days: [],
        constraintLevel: 'hard',
        sourceText: '平日は18時まで勉強できない',
      },
      {
        localId: 'availability-weekend',
        kind: 'preferred',
        dateExpression: '午前中',
        startTime: null,
        endTime: null,
        recurrenceKind: 'weekends',
        days: [],
        constraintLevel: 'soft',
        sourceText: '土日の午前中がやりやすい',
      },
    ],
    constraintSourceRequests: [
      {
        localId: 'source-timetable',
        kind: 'timetable',
        selector: 'active',
        requestedAction: 'use',
        sourceText: '時間割も考慮して',
      },
    ],
  };
}

describe('weekly planning semantic alpha2 validator', () => {
  it('accepts task constraints, plan-wide availability, and explicit source requests', () => {
    const result = validateWeeklyPlanningSemanticValueV2(createDocument());

    expect(result.errors).toEqual([]);
    expect(result.document?.tasks[0].temporalConstraints[0].constraintLevel).toBe('hard');
    expect(result.document?.availabilityDeclarations).toHaveLength(2);
    expect(result.document?.constraintSourceRequests[0]).toMatchObject({
      kind: 'timetable',
      requestedAction: 'use',
    });
  });

  it('generates a strict JSON schema with alpha2 availability fields', () => {
    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2.json_schema.schema;
    const required = schema.required as string[];
    const properties = schema.properties as Record<string, unknown>;

    expect(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2.json_schema.name)
      .toBe('weekly_planning_semantic_document_v5_alpha2');
    expect(required).toEqual(expect.arrayContaining([
      'availabilityDeclarations',
      'constraintSourceRequests',
    ]));
    expect(properties).toHaveProperty('availabilityDeclarations');
    expect(properties).toHaveProperty('constraintSourceRequests');
  });

  it('rejects a missing temporal constraint level', () => {
    const value = createDocument() as unknown as Record<string, unknown>;
    const tasks = value.tasks as Array<Record<string, unknown>>;
    const constraints = tasks[0].temporalConstraints as Array<Record<string, unknown>>;
    delete constraints[0].constraintLevel;

    const result = validateWeeklyPlanningSemanticValueV2(value);

    expect(result.document).toBeNull();
    expect(result.errors).toContain(
      'document.tasks[0].temporalConstraints[0].constraintLevel',
    );
  });

  it('rejects a hard preferred task window', () => {
    const document = createDocument();
    document.tasks[0].temporalConstraints[0] = {
      ...document.tasks[0].temporalConstraints[0],
      kind: 'preferred_window',
      constraintLevel: 'hard',
      startTime: '18:00',
      endTime: null,
    };

    const result = validateWeeklyPlanningSemanticValueV2(document);

    expect(result.errors).toContain(
      'document.tasks[0].temporalConstraints[0].constraintLevel:preferred-window-cannot-be-hard',
    );
  });

  it('rejects hard plan-wide preferences and soft unavailable windows', () => {
    const hardPreference = createDocument();
    hardPreference.availabilityDeclarations[1].constraintLevel = 'hard';
    expect(validateWeeklyPlanningSemanticValueV2(hardPreference).errors).toContain(
      'document.availabilityDeclarations[1].constraintLevel:preference-cannot-be-hard',
    );

    const softUnavailable = createDocument();
    softUnavailable.availabilityDeclarations[0].constraintLevel = 'soft';
    expect(validateWeeklyPlanningSemanticValueV2(softUnavailable).errors).toContain(
      'document.availabilityDeclarations[0].constraintLevel:soft-unavailable-use-avoided',
    );
  });

  it('rejects an availability declaration without any time scope', () => {
    const document = createDocument();
    document.availabilityDeclarations[0] = {
      ...document.availabilityDeclarations[0],
      dateExpression: null,
      startTime: null,
      endTime: null,
      recurrenceKind: null,
      days: [],
    };

    const result = validateWeeklyPlanningSemanticValueV2(document);

    expect(result.errors).toContain(
      'document.availabilityDeclarations[0]:missing-time-scope',
    );
  });

  it('rejects a duplicate local ID across task and availability facts', () => {
    const document = createDocument();
    document.availabilityDeclarations[0].localId = 'task-dinner';

    const result = validateWeeklyPlanningSemanticValueV2(document);

    expect(result.errors).toContain(
      'document.availabilityDeclarations[0].localId:duplicate:task-dinner',
    );
  });

  it('rejects days without a recurrence kind', () => {
    const document = createDocument();
    document.availabilityDeclarations[0].recurrenceKind = null;
    document.availabilityDeclarations[0].days = ['mon'];

    const result = validateWeeklyPlanningSemanticValueV2(document);

    expect(result.errors).toContain(
      'document.availabilityDeclarations[0].days:requires-recurrence',
    );
  });

  it('rejects an unsupported or non-active external source request', () => {
    const invalidKind = createDocument() as unknown as Record<string, unknown>;
    const requests = invalidKind.constraintSourceRequests as Array<Record<string, unknown>>;
    requests[0].kind = 'mail';
    expect(validateWeeklyPlanningSemanticValueV2(invalidKind).errors).toContain(
      'document.constraintSourceRequests[0].kind',
    );

    const invalidSelector = createDocument() as unknown as Record<string, unknown>;
    const secondRequests = invalidSelector.constraintSourceRequests as Array<Record<string, unknown>>;
    secondRequests[0].selector = 'latest';
    expect(validateWeeklyPlanningSemanticValueV2(invalidSelector).errors).toContain(
      'document.constraintSourceRequests[0].selector',
    );
  });

  it('accepts an ambiguous source as uncertainty without selecting a source', () => {
    const document = createDocument();
    document.constraintSourceRequests = [];
    document.uncertainties = [
      {
        localId: 'uncertainty-source',
        targetLocalId: 'document',
        field: 'constraintSource',
        reason: '参照する予定sourceが一意ではない',
        sourceText: '予定を見て',
      },
    ];

    const result = validateWeeklyPlanningSemanticValueV2(document);

    expect(result.errors).toEqual([]);
    expect(result.document?.constraintSourceRequests).toEqual([]);
  });

  it('returns invalid-json without falling back', () => {
    expect(parseWeeklyPlanningSemanticDocumentV2('{')).toEqual({
      document: null,
      errors: ['document:invalid-json'],
    });
  });
});
