import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  directWorkCoverageErrorsV5,
  extractDirectWorkExpectationsV5,
  missingDirectWorkExpectationsV5,
} from './weeklyPlanningDirectWorkCoverageV5';

function task(params: {
  localId: string;
  title: string;
  amount: number;
  unitCode: 'hour' | 'minute' | 'problem' | 'page' | 'custom';
  unitLabel: string;
  category?: 'study' | 'non_study';
}): SemanticTaskV5 {
  const category = params.category ?? 'study';
  return {
    localId: params.localId,
    category,
    title: params.title,
    study: category === 'study'
      ? {
          purpose: 'self_study',
          contextLabel: null,
          components: [],
        }
      : null,
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

describe('Stable V5 explicit work evidence coverage', () => {
  it('extracts independently quantified work across domains and units', () => {
    expect(extractDirectWorkExpectationsV5(
      'レポートを4ページ、演習を12問、片付けを30分進めたいです',
    )).toEqual([
      { label: 'レポート', amount: 4, unitCode: 'page', unitLabel: 'ページ' },
      { label: '演習', amount: 12, unitCode: 'problem', unitLabel: '問' },
      { label: '片付け', amount: 30, unitCode: 'minute', unitLabel: '分' },
    ]);

    expect(extractDirectWorkExpectationsV5(
      '申請書を2件；図を3枚；参考書を1冊確認する',
    )).toEqual([
      { label: '申請書', amount: 2, unitCode: 'custom', unitLabel: '件' },
      { label: '図', amount: 3, unitCode: 'custom', unitLabel: '枚' },
      { label: '参考書', amount: 1, unitCode: 'custom', unitLabel: '冊' },
    ]);
  });

  it('does not reinterpret replacement values in a correction as parallel new work', () => {
    expect(extractDirectWorkExpectationsV5(
      '修正します。演習は12問ではなく8問です',
    )).toEqual([]);
  });

  it('returns structured missing evidence instead of relying on a scenario prompt', () => {
    const input = document([
      task({
        localId: 'task-report',
        title: 'レポート',
        amount: 4,
        unitCode: 'page',
        unitLabel: 'ページ',
      }),
      task({
        localId: 'task-cleanup',
        title: '片付け',
        amount: 30,
        unitCode: 'minute',
        unitLabel: '分',
        category: 'non_study',
      }),
    ]);

    expect(missingDirectWorkExpectationsV5({
      userText: 'レポートを4ページ、演習を12問、片付けを30分進めたいです',
      document: input,
    })).toEqual([
      { label: '演習', amount: 12, unitCode: 'problem', unitLabel: '問' },
    ]);
    expect(directWorkCoverageErrorsV5({
      userText: 'レポートを4ページ、演習を12問、片付けを30分進めたいです',
      document: input,
    })).toEqual([
      'document.tasks:explicit-work-evidence-omitted:演習:12:problem',
    ]);
  });

  it('accepts evidence represented either at task or component depth', () => {
    const grouped: SemanticTaskV5 = {
      localId: 'task-project',
      category: 'study',
      title: '研究準備',
      study: {
        purpose: 'research',
        contextLabel: '研究準備',
        components: [
          {
            localId: 'component-reading',
            parentLocalId: null,
            role: 'material',
            label: '論文',
            workloads: [task({
              localId: 'temp-reading',
              title: '論文',
              amount: 3,
              unitCode: 'custom',
              unitLabel: '件',
            }).workloads[0]],
            sourceText: '論文を3件',
          },
          {
            localId: 'component-notes',
            parentLocalId: null,
            role: 'custom',
            label: 'メモ',
            workloads: [task({
              localId: 'temp-notes',
              title: 'メモ',
              amount: 2,
              unitCode: 'page',
              unitLabel: 'ページ',
            }).workloads[0]],
            sourceText: 'メモを2ページ',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '研究準備として論文を3件、メモを2ページ',
    };

    expect(directWorkCoverageErrorsV5({
      userText: '研究準備として、論文を3件、メモを2ページ進める',
      document: document([grouped]),
    })).toEqual([]);
  });
});
