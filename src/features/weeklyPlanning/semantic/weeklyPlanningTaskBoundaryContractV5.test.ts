import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticStudyComponentV5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  normalizeTaskBoundariesV5,
  taskBoundaryConformanceErrorsV5,
} from './weeklyPlanningTaskBoundaryContractV5';

function component(
  localId: string,
  label: string,
  hours: number,
  role: SemanticStudyComponentV5['role'] = 'subject',
): SemanticStudyComponentV5 {
  return {
    localId,
    parentLocalId: null,
    role,
    label,
    workloads: [{
      localId: `workload-${localId}`,
      quantityRole: 'declared',
      amount: hours,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${label}${hours}時間`,
    }],
    sourceText: label,
  };
}

function emptyComponent(
  localId: string,
  label: string,
): SemanticStudyComponentV5 {
  return {
    localId,
    parentLocalId: null,
    role: 'topic',
    label,
    workloads: [],
    sourceText: label,
  };
}

function task(params: {
  localId: string;
  title: string;
  contextLabel?: string | null;
  components: SemanticStudyComponentV5[];
}): SemanticTaskV5 {
  return {
    localId: params.localId,
    category: 'study',
    title: params.title,
    study: {
      purpose: 'self_study',
      contextLabel: params.contextLabel ?? null,
      components: params.components,
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: params.title,
  };
}

function document(
  tasks: SemanticTaskV5[],
  relations: WeeklyPlanningSemanticDocumentV5['relations'] = [],
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks,
    relations,
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 task boundary contract', () => {
  it('splits a pure container when one child was incorrectly used as its parent identity', () => {
    const input = document([
      task({
        localId: 'task-collided',
        title: '物理',
        components: [
          component('component-physics', '物理', 2),
          component('component-chemistry', '化学', 3),
        ],
      }),
    ]);

    const normalized = normalizeTaskBoundariesV5(input);

    expect(normalized.repairs).toEqual([
      'task-container-split-by-independent-roots:task-collided',
    ]);
    expect(normalized.document.tasks.map((item) => item.title)).toEqual([
      '物理',
      '化学',
    ]);
    expect(taskBoundaryConformanceErrorsV5(normalized.document)).toEqual([]);
  });

  it('keeps multiple quantified children under a genuine shared parent identity', () => {
    const input = document([
      task({
        localId: 'task-shared',
        title: '資格試験対策',
        components: [
          component('component-law', '法規', 2),
          component('component-theory', '理論', 3),
        ],
      }),
    ]);

    expect(normalizeTaskBoundariesV5(input)).toEqual({
      document: input,
      repairs: [],
    });
    expect(taskBoundaryConformanceErrorsV5(input)).toEqual([]);
  });

  it('uses an explicit shared context instead of splitting its children', () => {
    const input = document([
      task({
        localId: 'task-context',
        title: '統計',
        contextLabel: '卒業研究',
        components: [
          component('component-statistics', '統計', 2),
          component('component-writing', '執筆', 3, 'skill'),
        ],
      }),
    ]);

    const normalized = normalizeTaskBoundariesV5(input);

    expect(normalized.document.tasks).toHaveLength(1);
    expect(normalized.document.tasks[0]?.title).toBe('卒業研究');
    expect(normalized.repairs).toEqual([
      'task-parent-renamed-to-shared-context:task-context',
    ]);
  });

  it('does not perform a lossy split when task-level relations depend on the container', () => {
    const input = document(
      [
        task({
          localId: 'task-related',
          title: '設計',
          components: [
            component('component-design', '設計', 1, 'skill'),
            component('component-implementation', '実装', 2, 'skill'),
          ],
        }),
        task({
          localId: 'task-review',
          title: 'レビュー',
          components: [],
        }),
      ],
      [{
        localId: 'relation-1',
        kind: 'before',
        fromLocalId: 'task-related',
        toLocalId: 'task-review',
        sourceText: '設計と実装の後にレビュー',
      }],
    );

    const normalized = normalizeTaskBoundariesV5(input);

    expect(normalized.repairs).toEqual([]);
    expect(normalized.document).toBe(input);
    expect(taskBoundaryConformanceErrorsV5(normalized.document)).toEqual([
      'document.tasks.task-related:parent-title-collides-with-child:設計',
    ]);
  });

  it('does not drop an unquantified sibling root during normalization', () => {
    const input = document([
      task({
        localId: 'task-with-note',
        title: '分析',
        components: [
          component('component-analysis', '分析', 2, 'skill'),
          component('component-writing', '執筆', 3, 'skill'),
          emptyComponent('component-method', '方法の確認'),
        ],
      }),
    ]);

    const normalized = normalizeTaskBoundariesV5(input);

    expect(normalized.repairs).toEqual([]);
    expect(normalized.document).toBe(input);
    expect(normalized.document.tasks[0]?.study?.components).toHaveLength(3);
  });

  it('does not remove a task identity that an uncertainty still targets', () => {
    const input = document([
      task({
        localId: 'task-uncertain',
        title: '収集',
        components: [
          component('component-collection', '収集', 1, 'skill'),
          component('component-review', '確認', 2, 'skill'),
        ],
      }),
    ]);
    input.uncertainties.push({
      localId: 'uncertainty-1',
      targetLocalId: 'task-uncertain',
      field: 'category',
      reason: '分類を確認する必要がある',
      sourceText: '分類は未確定',
    });

    const normalized = normalizeTaskBoundariesV5(input);

    expect(normalized.repairs).toEqual([]);
    expect(normalized.document).toBe(input);
    expect(normalized.document.tasks[0]?.localId).toBe('task-uncertain');
  });

  it('does not split ordinary child topics whose parent title is distinct', () => {
    const input = document([
      task({
        localId: 'task-language',
        title: '英語',
        components: [
          component('component-grammar', '文法', 1, 'topic'),
          component('component-reading', '長文', 1, 'skill'),
        ],
      }),
    ]);

    expect(normalizeTaskBoundariesV5(input)).toEqual({
      document: input,
      repairs: [],
    });
  });
});
