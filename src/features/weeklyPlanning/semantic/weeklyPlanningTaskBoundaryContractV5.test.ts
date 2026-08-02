import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticStudyComponentV5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  taskBoundaryConformanceErrorsV5,
  taskBoundaryInstructionV5,
} from './weeklyPlanningTaskBoundaryContractV5';

function subject(
  localId: string,
  label: string,
  hours: number,
): SemanticStudyComponentV5 {
  return {
    localId,
    parentLocalId: null,
    role: 'subject',
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

function task(params: {
  localId: string;
  title: string;
  contextLabel: string | null;
  components: SemanticStudyComponentV5[];
}): SemanticTaskV5 {
  return {
    localId: params.localId,
    category: 'study',
    title: params.title,
    study: {
      purpose: 'self_study',
      contextLabel: params.contextLabel,
      components: params.components,
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: params.title,
  };
}

function document(tasks: SemanticTaskV5[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 task boundary contract', () => {
  it('rejects sibling subjects grouped under one child title without a shared context', () => {
    const errors = taskBoundaryConformanceErrorsV5(document([
      task({
        localId: 'task-grouped',
        title: '英語',
        contextLabel: null,
        components: [
          subject('component-english', '英語', 2),
          subject('component-math', '数学', 3),
        ],
      }),
    ]));

    expect(errors).toEqual([
      'document.tasks.task-grouped:parent-title-collides-with-subject:英語',
      'document.tasks.task-grouped:multiple-subjects-require-shared-context:英語|数学',
    ]);
  });

  it('accepts multiple subjects under an explicit shared exam context', () => {
    expect(taskBoundaryConformanceErrorsV5(document([
      task({
        localId: 'task-exam',
        title: '大学院入試対策',
        contextLabel: '大学院入試',
        components: [
          subject('component-field-a', '専門分野A', 2),
          subject('component-field-b', '専門分野B', 3),
        ],
      }),
    ]))).toEqual([]);
  });

  it('accepts independent subjects as separate top-level tasks', () => {
    expect(taskBoundaryConformanceErrorsV5(document([
      task({
        localId: 'task-english',
        title: '英語',
        contextLabel: null,
        components: [subject('component-english', '英語', 2)],
      }),
      task({
        localId: 'task-math',
        title: '数学',
        contextLabel: null,
        components: [subject('component-math', '数学', 3)],
      }),
    ]))).toEqual([]);
  });

  it('does not affect multiple non-subject components within one subject task', () => {
    const grammar = {
      ...subject('component-grammar', '文法', 1),
      role: 'topic' as const,
    };
    const reading = {
      ...subject('component-reading', '長文', 1),
      role: 'skill' as const,
    };
    expect(taskBoundaryConformanceErrorsV5(document([
      task({
        localId: 'task-english',
        title: '英語',
        contextLabel: null,
        components: [grammar, reading],
      }),
    ]))).toEqual([]);
  });

  it('states both the grouping permission and separation rule in the prompt contract', () => {
    const instruction = taskBoundaryInstructionV5();
    expect(instruction).toContain('explicitly names a shared exam, course, project');
    expect(instruction).toContain('create separate top-level tasks');
    expect(instruction).toContain('Never use one child subject label as the parent task title');
  });
});
