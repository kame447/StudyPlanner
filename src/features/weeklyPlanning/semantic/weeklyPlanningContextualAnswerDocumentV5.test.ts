import { describe, expect, it } from 'vitest';
import {
  createGroundedContextualAnswerDocumentV5,
} from './weeklyPlanningContextualAnswerDocumentV5';

describe('Stable V5 contextual answer ownership', () => {
  it.each([
    '今回進めたい量です',
    '残っている全体量です',
    '3時間です',
    'だいたい2時間半くらいです',
    '違います。合計3時間です',
    'ページ数ではなく、数学40問の所要時間は合計3時間です',
  ])('never synthesizes a semantic document from user wording: %s', (userText) => {
    expect(createGroundedContextualAnswerDocumentV5({
      userText,
      publicStateSummary: {
        graphRevision: 4,
        pendingQuestion: {
          actionId: 'pending-action',
          questionCode: 'missing_effort_estimate',
          targetFactId: 'workload-math',
          graphRevision: 4,
        },
      },
    })).toBeNull();
  });
});
