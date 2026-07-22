import { describe, expect, it } from 'vitest';
import {
  parseSemanticPlanningDocument,
  SEMANTIC_PLANNING_SCHEMA_VERSION,
  validateSemanticPlanningDocument,
} from './weeklyPlanningSemanticExperiment';

const validDocument = {
  schemaVersion: SEMANTIC_PLANNING_SCHEMA_VERSION,
  planningIntent: 'create_plan',
  planningWindow: null,
  tasks: [
    {
      localId: 'task-study',
      category: 'study',
      title: '資格試験の勉強',
      study: {
        purpose: 'exam',
        contextLabel: '基本情報技術者試験',
        components: [
          {
            localId: 'component-algorithm',
            parentLocalId: null,
            role: 'field',
            label: 'アルゴリズム',
            workloads: [
              {
                kind: 'target',
                amount: 30,
                unitCode: 'problem',
                unitLabel: '問',
                rangeStart: null,
                rangeEnd: null,
                perOccurrence: false,
                sourceText: '過去問30問',
              },
            ],
            sourceText: 'アルゴリズムを過去問30問',
          },
        ],
      },
      workloads: [],
      scheduleConstraints: [],
      recurrence: [],
      sourceText: '基本情報技術者試験に向けて、アルゴリズムを過去問30問進めたい',
    },
  ],
  relations: [],
  uncertainties: [],
};

describe('weekly planning semantic experiment', () => {
  it('accepts the generic task/component/workload document', () => {
    expect(validateSemanticPlanningDocument(validDocument)).toEqual([]);
    const parsed = parseSemanticPlanningDocument(JSON.stringify(validDocument));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.tasks[0].study?.components[0].workloads[0].amount).toBe(30);
  });

  it('rejects duplicate task IDs and unknown relation targets', () => {
    const invalid = {
      ...validDocument,
      tasks: [validDocument.tasks[0], { ...validDocument.tasks[0] }],
      relations: [
        {
          kind: 'before',
          fromLocalId: 'missing-task',
          toLocalId: 'task-study',
          sourceText: 'その前に',
        },
      ],
    };
    const errors = validateSemanticPlanningDocument(invalid);
    expect(errors).toContain('tasks[1].localId:duplicate');
    expect(errors).toContain('relations[0].fromLocalId');
  });

  it('rejects non-study tasks that carry study details', () => {
    const invalid = {
      ...validDocument,
      tasks: [
        {
          ...validDocument.tasks[0],
          category: 'non_study',
        },
      ],
    };
    expect(validateSemanticPlanningDocument(invalid)).toContain('tasks[0].study:must-be-null');
  });
});
