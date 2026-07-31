import { describe, expect, it } from 'vitest';
import {
  allConversationEvalChecksPass,
  evaluateExplicitRepairContract,
  evaluatePreviewCorrectionContract,
} from './weeklyPlanningConversationEvalContracts';

describe('weekly planning conversation eval contracts', () => {
  it('accepts an explicit repair only when the question target is preserved', () => {
    const checks = evaluateExplicitRepairContract({
      expectedQuestionCode: 'missing_effort_estimate',
      expectedTargetFactId: 'workload-math',
      activeTaskCountBeforeWrongAnswer: 1,
      expectedRepairedTotalMinutes: 180,
      beforeWrongAnswer: {
        graphRevision: 2,
        previewCount: 0,
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-math',
        activeTaskCount: 1,
        totalPreviewMinutes: 0,
      },
      afterWrongAnswer: {
        graphRevision: 3,
        previewCount: 0,
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-math',
        activeTaskCount: 1,
        totalPreviewMinutes: 0,
      },
      afterRepair: {
        graphRevision: 4,
        previewCount: 2,
        questionCode: null,
        targetFactId: null,
        activeTaskCount: 1,
        totalPreviewMinutes: 180,
      },
    });

    expect(allConversationEvalChecksPass(checks)).toBe(true);
  });

  it('detects a repair that binds to a different task', () => {
    const checks = evaluateExplicitRepairContract({
      expectedQuestionCode: 'missing_effort_estimate',
      expectedTargetFactId: 'workload-math',
      activeTaskCountBeforeWrongAnswer: 1,
      expectedRepairedTotalMinutes: 180,
      beforeWrongAnswer: {
        graphRevision: 2,
        previewCount: 0,
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-math',
        activeTaskCount: 1,
        totalPreviewMinutes: 0,
      },
      afterWrongAnswer: {
        graphRevision: 3,
        previewCount: 0,
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-english',
        activeTaskCount: 1,
        totalPreviewMinutes: 0,
      },
      afterRepair: {
        graphRevision: 4,
        previewCount: 1,
        questionCode: null,
        targetFactId: null,
        activeTaskCount: 1,
        totalPreviewMinutes: 180,
      },
    });

    expect(checks.targetFactPreserved).toBe(false);
    expect(allConversationEvalChecksPass(checks)).toBe(false);
  });

  it('detects an incompatible reply that was not recorded as a turn', () => {
    const checks = evaluateExplicitRepairContract({
      expectedQuestionCode: 'missing_effort_estimate',
      expectedTargetFactId: 'workload-math',
      activeTaskCountBeforeWrongAnswer: 1,
      expectedRepairedTotalMinutes: 180,
      beforeWrongAnswer: {
        graphRevision: 2,
        previewCount: 0,
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-math',
        activeTaskCount: 1,
        totalPreviewMinutes: 0,
      },
      afterWrongAnswer: {
        graphRevision: 2,
        previewCount: 0,
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-math',
        activeTaskCount: 1,
        totalPreviewMinutes: 0,
      },
      afterRepair: {
        graphRevision: 3,
        previewCount: 1,
        questionCode: null,
        targetFactId: null,
        activeTaskCount: 1,
        totalPreviewMinutes: 180,
      },
    });

    expect(checks.wrongAnswerTurnRecorded).toBe(false);
    expect(allConversationEvalChecksPass(checks)).toBe(false);
  });

  it('requires preview correction to clear the old preview and create a new identity', () => {
    const checks = evaluatePreviewCorrectionContract({
      expectedCorrectedTotalMinutes: 180,
      beforeCorrection: {
        graphRevision: 4,
        previewKeys: ['revision-4:english', 'revision-4:math'],
        totalPreviewMinutes: 300,
      },
      correctionTurn: {
        graphRevision: 5,
        previewKeys: [],
        totalPreviewMinutes: 0,
      },
      afterCorrection: {
        graphRevision: 6,
        previewKeys: ['revision-6:english', 'revision-6:math'],
        totalPreviewMinutes: 180,
      },
    });

    expect(allConversationEvalChecksPass(checks)).toBe(true);
  });

  it('detects stale preview reuse after a correction', () => {
    const checks = evaluatePreviewCorrectionContract({
      expectedCorrectedTotalMinutes: 180,
      beforeCorrection: {
        graphRevision: 4,
        previewKeys: ['revision-4:english', 'revision-4:math'],
        totalPreviewMinutes: 300,
      },
      correctionTurn: {
        graphRevision: 5,
        previewKeys: ['revision-4:english', 'revision-4:math'],
        totalPreviewMinutes: 300,
      },
      afterCorrection: {
        graphRevision: 6,
        previewKeys: ['revision-4:english', 'revision-4:math'],
        totalPreviewMinutes: 180,
      },
    });

    expect(checks.correctionClearedPreview).toBe(false);
    expect(checks.previewIdentityChanged).toBe(false);
    expect(allConversationEvalChecksPass(checks)).toBe(false);
  });
});
