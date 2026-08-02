import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  directWorkCoverageErrorsV5,
  directWorkCoverageInstructionV5,
  extractDirectWorkExpectationsV5,
} from './weeklyPlanningDirectWorkCoverageV5';

function task(params: {
  localId: string;
  title: string;
  amount: number;
  unitCode: 'hour' | 'problem';
  unitLabel: string;
}): SemanticTaskV5 {
  return {
    localId: params.localId,
    category: 'study',
    title: params.title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: `workload-${params.localId}`,
      quantityRole: 'declared',
      amount: params.amount,
      unitCode: params.unitCode,
      unitLabel: params.unitLabel,
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${params.title}${params.amount}${params.unitLabel}`,
    }],
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

describe('Stable V5 direct work coverage contract', () => {
  it('extracts every independently quantified clause from the latest user text', () => {
    expect(extractDirectWorkExpectationsV5(
      '来週、英語を2時間、数学を3時間やりたいです',
    )).toEqual([
      { label: '英語', amount: 2, unitCode: 'hour', unitLabel: '時間' },
      { label: '数学', amount: 3, unitCode: 'hour', unitLabel: '時間' },
    ]);
    expect(extractDirectWorkExpectationsV5(
      '数学の問題を40問進めたいです',
    )).toEqual([
      { label: '数学の問題', amount: 40, unitCode: 'problem', unitLabel: '問' },
    ]);
  });

  it('does not reinterpret correction utterances as simultaneous required values', () => {
    expect(extractDirectWorkExpectationsV5(
      '訂正です。数学は3時間ではなく1時間にしてください',
    )).toEqual([]);
  });

  it('reports only the explicit work item omitted from the semantic document', () => {
    expect(directWorkCoverageErrorsV5({
      userText: '来週、英語を2時間、数学を3時間やりたいです',
      document: document([
        task({
          localId: 'task-english',
          title: '英語',
          amount: 2,
          unitCode: 'hour',
          unitLabel: '時間',
        }),
      ]),
    })).toEqual([
      'document.tasks:direct-work-omitted:数学:3:hour',
    ]);
  });

  it('accepts all explicit work items whether represented as separate tasks or shared components', () => {
    const grouped: SemanticTaskV5 = {
      localId: 'task-exam',
      category: 'study',
      title: '試験対策',
      study: {
        purpose: 'exam',
        contextLabel: '試験',
        components: [
          {
            localId: 'component-english',
            parentLocalId: null,
            role: 'subject',
            label: '英語',
            workloads: [task({
              localId: 'temp-english',
              title: '英語',
              amount: 2,
              unitCode: 'hour',
              unitLabel: '時間',
            }).workloads[0]],
            sourceText: '英語を2時間',
          },
          {
            localId: 'component-math',
            parentLocalId: null,
            role: 'subject',
            label: '数学',
            workloads: [task({
              localId: 'temp-math',
              title: '数学',
              amount: 3,
              unitCode: 'hour',
              unitLabel: '時間',
            }).workloads[0]],
            sourceText: '数学を3時間',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '試験対策として英語を2時間、数学を3時間',
    };
    expect(directWorkCoverageErrorsV5({
      userText: '試験対策として、英語を2時間、数学を3時間やりたいです',
      document: document([grouped]),
    })).toEqual([]);
  });

  it('states that later coordinated items must not be dropped', () => {
    expect(directWorkCoverageInstructionV5()).toContain(
      'Do not drop a later coordinated item',
    );
  });
});
