import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import {
  validateWeeklyPlanningSemanticValueV2WithDateRules,
} from './weeklyPlanningSemanticValidatorV2DateRules';

function document(): WeeklyPlanningSemanticDocumentV2 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-study',
      category: 'study',
      title: '英単語',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'date-rule-1',
        targetLocalId: 'task-study',
        kind: 'excluded_date',
        constraintLevel: 'hard',
        dateExpression: '2026-07-25',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        sourceText: '25日は英単語をやらない',
      }],
      recurrence: [],
      sourceText: '英単語は25日だけやらない',
    }],
    relations: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
  };
}

describe('weekly planning semantic task date rules', () => {
  it('accepts an exact hard allowed or excluded date rule', () => {
    const excluded = validateWeeklyPlanningSemanticValueV2WithDateRules(document());
    expect(excluded.errors).toEqual([]);
    expect(excluded.document?.tasks[0].temporalConstraints[0].kind)
      .toBe('excluded_date');

    const allowed = document();
    allowed.tasks[0].temporalConstraints[0].kind = 'allowed_date';
    expect(validateWeeklyPlanningSemanticValueV2WithDateRules(allowed).errors)
      .toEqual([]);
  });

  it('includes task date rule kinds in the strict response schema', () => {
    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2.json_schema.schema;
    const taskSchema = ((schema.properties as Record<string, unknown>).tasks as {
      items: { properties: Record<string, unknown> };
    }).items;
    const temporalSchema = taskSchema.properties.temporalConstraints as {
      items: { properties: Record<string, unknown> };
    };
    const kind = temporalSchema.items.properties.kind as { enum: string[] };

    expect(kind.enum).toEqual(expect.arrayContaining([
      'allowed_date',
      'excluded_date',
    ]));
  });

  it('rejects a date rule that points at another task', () => {
    const invalid = document();
    invalid.tasks[0].temporalConstraints[0].targetLocalId = 'task-other';

    expect(validateWeeklyPlanningSemanticValueV2WithDateRules(invalid).errors)
      .toContain(
        'document.tasks[0].temporalConstraints[0].targetLocalId:must-target-containing-task',
      );
  });

  it('rejects clocks, named periods, or soft strength on a date rule', () => {
    const withClock = document();
    withClock.tasks[0].temporalConstraints[0].startTime = '18:00';
    expect(validateWeeklyPlanningSemanticValueV2WithDateRules(withClock).errors)
      .toContain('document.tasks[0].temporalConstraints[0]:date-rule-cannot-have-clock');

    const withPeriod = document();
    withPeriod.tasks[0].temporalConstraints[0].namedTimePeriod = 'morning';
    expect(validateWeeklyPlanningSemanticValueV2WithDateRules(withPeriod).errors)
      .toContain(
        'document.tasks[0].temporalConstraints[0].namedTimePeriod:must-be-null-for-date-rule',
      );

    const soft = document();
    soft.tasks[0].temporalConstraints[0].constraintLevel = 'soft';
    expect(validateWeeklyPlanningSemanticValueV2WithDateRules(soft).errors)
      .toContain(
        'document.tasks[0].temporalConstraints[0].constraintLevel:date-rule-must-be-hard',
      );
  });

  it('rejects Japanese date text instead of reparsing it downstream', () => {
    const invalid = document();
    invalid.tasks[0].temporalConstraints[0].dateExpression = '今週の土曜日';

    expect(validateWeeklyPlanningSemanticValueV2WithDateRules(invalid).errors)
      .toContain(
        'document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression-required',
      );
  });
});
