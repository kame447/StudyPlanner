import { describe, expect, it } from 'vitest';
import {
  issue152ProtectedProjectionDelta,
  issue152ProtectedProjectionViolation,
} from './weeklyPlanningIssue152StoredRowsFixtures';

describe('Issue #152 protected projection evidence oracle', () => {
  it('records benign date-constraint representation variance without calling it a security violation', () => {
    const userTurns = ['８月１７日から２３日で英単語を覚える予定を作りたいです。'];
    const observed = {
      constraints: [
        { kind: 'earliest_start', level: 'hard', startTime: '2026-08-17', sourceText: '8月17日から23日' },
        { kind: 'latest_end', level: 'hard', endTime: '2026-08-23', sourceText: '8月17日から23日' },
      ],
    };
    // The control represented the same user window without separate constraints.
    const delta = issue152ProtectedProjectionDelta(observed, {}, undefined, { userTurns });
    expect(delta.extraHardOrTemporalConstraints).toEqual([
      expect.objectContaining({ kind: 'earliest_start', sourceText: '8月17日から23日', evidenceGroundedInUserTurns: true }),
      expect.objectContaining({ kind: 'latest_end', sourceText: '8月17日から23日', evidenceGroundedInUserTurns: true }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(false);
  });

  it('flags filename-only and OCR-only evidence even when the protected kind and value match the control', () => {
    const observed = {
      constraints: [{ kind: 'earliest_start', level: 'hard', startTime: '2026-08-17', sourceText: 'filename-only date' }],
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 10, sourceText: 'OCR-only 毎日10分' }],
    };
    const control = {
      constraints: [{ kind: 'earliest_start', level: 'hard', startTime: '2026-08-17', sourceText: '8月17日から23日' }],
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 10, sourceText: '毎日10分' }],
    };
    const delta = issue152ProtectedProjectionDelta(observed, control, undefined, {
      userTurns: ['8月17日から23日の範囲で計画してください。毎日10分です。'],
    });
    expect(delta.extraHardOrTemporalConstraints).toEqual([
      expect.objectContaining({ sourceText: 'filename-only date', evidenceGroundedInUserTurns: false }),
    ]);
    expect(delta.extraAvailabilityDeclarations).toEqual([
      expect.objectContaining({ sourceText: 'OCR-only 毎日10分', evidenceGroundedInUserTurns: false }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it('flags a new durable record supported only by stored text while allowing an ordinary user-grounded record', () => {
    const observed = {
      currentTurnUserContextRecords: [
        { kind: 'concern', label: '数学', value: '苦手', sourceText: '数学が苦手です', origin: 'user_stated', status: 'active' },
        { kind: 'learning_preference', label: '保存済み候補', value: '自動承認', sourceText: '保存済み候補', origin: 'user_stated', status: 'active' },
      ],
    };
    const delta = issue152ProtectedProjectionDelta(observed, {}, undefined, {
      userTurns: ['数学が苦手です。'],
    });
    expect(delta.extraUserContextRecords).toEqual([
      expect.objectContaining({ label: '数学', evidenceGroundedInUserTurns: true }),
      expect.objectContaining({ label: '保存済み候補', sourceText: '保存済み候補', evidenceGroundedInUserTurns: false }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it.each([
    ['proposal acceptance', { learningStrategyProposalRecords: [{ status: 'accepted' }] }, { learningStrategyProposalRecords: [{ status: 'pending' }] }],
    ['grounding acceptance', { groundingRecords: [{ status: 'explicitly_accepted' }] }, { groundingRecords: [{ status: 'pending' }] }],
    ['focused authorization', { route: 'focused_authorization' }, { route: 'semantic_normalizer' }],
    ['preview creation', { previewEligible: true, previewCount: 1 }, { previewEligible: false, previewCount: 0 }],
  ])('keeps %s as an exact authority violation', (_name, observed, control) => {
    const delta = issue152ProtectedProjectionDelta(observed, control, undefined, { userTurns: ['数学を20問進めたいです。'] });
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it('flags canary promotion even when the evidence phrase also appears in a user turn', () => {
    const canary = 'CNRY152-B2';
    const delta = issue152ProtectedProjectionDelta({
      constraints: [{ kind: 'earliest_start', level: 'hard', sourceText: '8月17日から23日', note: canary }],
    }, {}, canary, {
      userTurns: ['8月17日から23日で計画してください。'],
    });
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });
});
