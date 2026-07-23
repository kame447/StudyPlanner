import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import {
  parseWeeklyPlanningSemanticDocument,
  validateWeeklyPlanningSemanticValue,
} from './weeklyPlanningSemanticValidator';

function createValidDocument(): WeeklyPlanningSemanticDocument {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-study',
        category: 'study',
        title: '院試の過去問',
        study: {
          purpose: 'exam',
          contextLabel: '大学院入試',
          components: [
            {
              localId: 'component-os-network',
              parentLocalId: null,
              role: 'field',
              label: 'OSとネットワーク',
              workloads: [
                {
                  localId: 'workload-os-network',
                  quantityRole: 'declared',
                  amount: 1,
                  unitCode: 'exam_year',
                  unitLabel: '年分',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: 'OSとネットワークは1年分',
                },
              ],
              sourceText: 'OSとネットワーク',
            },
            {
              localId: 'component-human-science',
              parentLocalId: null,
              role: 'field',
              label: 'ヒューマンサイエンス',
              workloads: [
                {
                  localId: 'workload-human-science',
                  quantityRole: 'declared',
                  amount: 2,
                  unitCode: 'exam_year',
                  unitLabel: '年分',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: 'ヒューマンサイエンスは2年分',
                },
              ],
              sourceText: 'ヒューマンサイエンス',
            },
          ],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '院試の過去問を進めたい',
      },
      {
        localId: 'task-research',
        category: 'non_study',
        title: '研究',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'constraint-research-end',
            targetLocalId: 'task-research',
            kind: 'latest_end',
            dateExpression: null,
            startTime: null,
            endTime: '15:00',
            precision: 'approximate',
            sourceText: '研究も15時くらいまで',
          },
        ],
        recurrence: [],
        sourceText: '研究も15時くらいまで進めないといけません',
      },
    ],
    relations: [
      {
        localId: 'relation-research-before-study',
        kind: 'before',
        fromLocalId: 'task-research',
        toLocalId: 'task-study',
        sourceText: 'その前に研究',
      },
    ],
    uncertainties: [
      {
        localId: 'uncertainty-research-start',
        targetLocalId: 'task-research',
        field: 'startTime',
        reason: '開始時刻が明示されていない',
        sourceText: '15時くらいまで',
      },
    ],
    corrections: [],
    decisions: [],
  };
}

describe('weekly planning semantic validator', () => {
  it('accepts generic study and non-study tasks with per-component workload', () => {
    const result = validateWeeklyPlanningSemanticValue(createValidDocument());

    expect(result.errors).toEqual([]);
    expect(result.document?.tasks).toHaveLength(2);
    expect(result.document?.tasks[0].study?.components[0].workloads[0].quantityRole)
      .toBe('declared');
  });

  it('keeps a partial latest-end fact without inventing a start time', () => {
    const result = validateWeeklyPlanningSemanticValue(createValidDocument());
    const constraint = result.document?.tasks[1].temporalConstraints[0];

    expect(constraint).toMatchObject({
      kind: 'latest_end',
      startTime: null,
      endTime: '15:00',
      precision: 'approximate',
    });
  });

  it('rejects globally duplicated local IDs', () => {
    const document = createValidDocument();
    document.tasks[1].localId = 'task-study';

    const result = validateWeeklyPlanningSemanticValue(document);

    expect(result.document).toBeNull();
    expect(result.errors.some((error) => error.includes('duplicate:task-study'))).toBe(true);
  });

  it('rejects an effort estimate targeting another task', () => {
    const document = createValidDocument();
    document.tasks[0].effortEstimates.push({
      localId: 'estimate-cross-task',
      targetLocalId: 'task-research',
      kind: 'total_duration',
      minutes: 60,
      unitCode: null,
      precision: 'approximate',
      sourceText: '1時間くらい',
    });

    const result = validateWeeklyPlanningSemanticValue(document);

    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].effortEstimates[0].targetLocalId');
  });

  it('rejects a component parent cycle', () => {
    const document = createValidDocument();
    const components = document.tasks[0].study?.components;
    if (!components) throw new Error('fixture must have components');
    components[0].parentLocalId = components[1].localId;
    components[1].parentLocalId = components[0].localId;

    const result = validateWeeklyPlanningSemanticValue(document);

    expect(result.document).toBeNull();
    expect(result.errors.some((error) => error.includes('parent-cycle'))).toBe(true);
  });

  it('keeps relative planning windows symbolic', () => {
    const document = createValidDocument();
    document.planningWindow = {
      localId: 'window-next-week',
      kind: 'relative_week',
      value: '来週',
      start: '2026-07-27',
      end: '2026-08-02',
      sourceText: '来週の予定',
    };

    const result = validateWeeklyPlanningSemanticValue(document);

    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.planningWindow:relative-must-remain-symbolic');
  });

  it('rejects a correction that points to an unknown local ID', () => {
    const document = createValidDocument();
    document.corrections.push({
      localId: 'correction-1',
      target: {
        kind: 'task',
        publicId: null,
        localId: 'missing-task',
        mention: null,
      },
      operation: 'remove',
      replacementLocalId: null,
      sourceText: 'それは消して',
    });

    const result = validateWeeklyPlanningSemanticValue(document);

    expect(result.document).toBeNull();
    expect(result.errors).toContain(
      'document.corrections[0].target.localId:unknown:missing-task',
    );
  });

  it('returns a closed invalid-json result', () => {
    expect(parseWeeklyPlanningSemanticDocument('{')).toEqual({
      document: null,
      errors: ['document:invalid-json'],
    });
  });

  it('accepts arbitrary positive declared workload amounts', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000 }), (amount) => {
      const document = createValidDocument();
      const workload = document.tasks[0].study?.components[0].workloads[0];
      if (!workload) throw new Error('fixture must have workload');
      workload.amount = amount;
      const result = validateWeeklyPlanningSemanticValue(document);
      expect(result.errors).toEqual([]);
    }));
  });
});
