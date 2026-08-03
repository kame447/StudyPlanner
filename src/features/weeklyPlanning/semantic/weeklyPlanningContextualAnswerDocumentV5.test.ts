import { describe, expect, it } from 'vitest';
import {
  createGroundedContextualAnswerDocumentV5,
} from './weeklyPlanningContextualAnswerDocumentV5';

function summary(params: {
  questionCode: 'quantity_role_unresolved' | 'missing_effort_estimate';
  revision?: number;
  pendingRevision?: number;
  targetFactId?: string | null;
}): Record<string, unknown> {
  const revision = params.revision ?? 4;
  return {
    graphRevision: revision,
    pendingQuestion: {
      actionId: `action-${params.questionCode}`,
      questionCode: params.questionCode,
      targetFactId: params.targetFactId === undefined
        ? 'workload-language'
        : params.targetFactId,
      graphRevision: params.pendingRevision ?? revision,
    },
    tasks: [{
      publicId: 'task-language',
      category: 'study',
      title: '語学学習',
    }],
    components: [],
    workloads: [{
      publicId: 'workload-language',
      taskPublicId: 'task-language',
      componentPublicId: null,
      quantityRole: 'unknown',
      amount: 2,
      unitCode: 'hour',
      unitLabel: '時間',
    }],
  };
}

function explicitRepairSummary(): Record<string, unknown> {
  return {
    graphRevision: 2,
    pendingQuestion: {
      actionId: 'action-missing-effort',
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-math',
      graphRevision: 2,
    },
    tasks: [{
      publicId: 'task-math',
      category: 'study',
      title: '数学の問題を進める',
    }],
    components: [{
      publicId: 'component-math',
      taskPublicId: 'task-math',
      parentComponentPublicId: null,
      role: 'subject',
      label: '数学',
    }],
    workloads: [{
      publicId: 'workload-math',
      taskPublicId: 'task-math',
      componentPublicId: 'component-math',
      quantityRole: 'target',
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
    }],
  };
}

describe('Stable V5 machine-targeted short answer document', () => {
  it.each([
    ['今回進めたい量です', 'target'],
    ['残っている全体量です', 'remaining'],
    ['完了済みです', 'completed'],
    ['2時間が今回進めたい量です', 'target'],
  ] as const)('grounds quantity-role-only replies: %s', (userText, role) => {
    const result = createGroundedContextualAnswerDocumentV5({
      userText,
      publicStateSummary: summary({ questionCode: 'quantity_role_unresolved' }),
    });

    expect(result).toMatchObject({
      document: {
        planningIntent: 'discuss',
        tasks: [{
          title: '語学学習',
          workloads: [{
            quantityRole: role,
            amount: 2,
            unitCode: 'hour',
          }],
        }],
        uncertainties: [],
        corrections: [],
      },
      repairs: [
        'contextual-answer-grounded-from-machine-question:quantity_role_unresolved',
      ],
    });
  });

  it.each([
    ['3時間です', 180, 'exact'],
    ['だいたい2時間半くらいです', 150, 'approximate'],
    ['45分かかります', 45, 'exact'],
  ] as const)('grounds duration-only replies: %s', (userText, minutes, precision) => {
    const result = createGroundedContextualAnswerDocumentV5({
      userText,
      publicStateSummary: summary({ questionCode: 'missing_effort_estimate' }),
    });

    expect(result).toMatchObject({
      document: {
        tasks: [{
          title: '語学学習',
          effortEstimates: [{
            kind: 'total_duration',
            minutes,
            precision,
          }],
        }],
      },
      repairs: [
        'contextual-answer-grounded-from-machine-question:missing_effort_estimate',
      ],
    });
  });

  it.each([
    '違います。合計3時間です',
    '違います。ページ数ではなく、数学40問の所要時間は合計3時間です',
  ])('grounds an explicit repair to the exact machine-selected workload: %s', (userText) => {
    const result = createGroundedContextualAnswerDocumentV5({
      userText,
      publicStateSummary: explicitRepairSummary(),
    });

    expect(result).toMatchObject({
      document: {
        tasks: [{
          title: '数学の問題を進める',
          effortEstimates: [{
            kind: 'total_duration',
            minutes: 180,
          }],
        }],
      },
    });
  });

  it.each([
    {
      userText: '今回進めたい量で、明日にします',
      state: summary({ questionCode: 'quantity_role_unresolved' }),
    },
    {
      userText: '今回進めたい量です。数学も追加します',
      state: summary({ questionCode: 'quantity_role_unresolved' }),
    },
    {
      userText: '2時間ではなく3時間です',
      state: summary({ questionCode: 'missing_effort_estimate' }),
    },
    {
      userText: '3時間です。夜にやります',
      state: summary({ questionCode: 'missing_effort_estimate' }),
    },
    {
      userText: '違います。英語40問の所要時間は3時間です',
      state: explicitRepairSummary(),
    },
    {
      userText: '違います。数学40問の所要時間は明日3時間です',
      state: explicitRepairSummary(),
    },
    {
      userText: '今回進めたい量です',
      state: summary({
        questionCode: 'quantity_role_unresolved',
        revision: 5,
        pendingRevision: 4,
      }),
    },
    {
      userText: '今回進めたい量です',
      state: summary({
        questionCode: 'quantity_role_unresolved',
        targetFactId: 'missing-workload',
      }),
    },
  ])('leaves non-answer-only or unsafe cases on the normal semantic path', ({ userText, state }) => {
    expect(createGroundedContextualAnswerDocumentV5({
      userText,
      publicStateSummary: state,
    })).toBeNull();
  });

  it('rejects a repeated duration that conflicts with the machine target quantity', () => {
    expect(createGroundedContextualAnswerDocumentV5({
      userText: '3時間が今回進めたい量です',
      publicStateSummary: summary({ questionCode: 'quantity_role_unresolved' }),
    })).toBeNull();
  });
});
