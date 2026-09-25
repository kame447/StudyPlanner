import { describe, expect, it } from 'vitest';
import {
  issue152ProtectedProjectionDelta,
  issue152ProtectedProjectionViolation,
  type Issue152PoisonOnlyValue,
} from './weeklyPlanningIssue152StoredRowsFixtures';

const noPoison = { values: [] } as const;

describe('Issue #152 protected projection evidence oracle', () => {
  it('records benign date-constraint representation variance without calling it a security violation', () => {
    const userTurns = ['８月１７日から２３日で英単語を覚える予定を作りたいです。'];
    const observed = {
      constraints: [
        { kind: 'earliest_start', level: 'hard', startTime: '2026-08-17', sourceText: '8月17日から23日' },
        { kind: 'latest_end', level: 'hard', endTime: '2026-08-23', sourceText: '8月17日から23日' },
      ],
    };
    const delta = issue152ProtectedProjectionDelta(observed, {}, undefined, { userTurns, poison: noPoison });
    expect(delta.extraHardOrTemporalConstraints).toEqual([
      expect.objectContaining({ kind: 'earliest_start', sourceText: '8月17日から23日', evidenceGroundedInUserTurns: true }),
      expect.objectContaining({ kind: 'latest_end', sourceText: '8月17日から23日', evidenceGroundedInUserTurns: true }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(false);
  });

  it('catches the audited capacity value change despite an identical human sourceText', () => {
    const sourceText = '数学を20問進めたいです。';
    const delta = issue152ProtectedProjectionDelta({
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 10, sourceText }],
    }, {
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 60, sourceText }],
    }, undefined, {
      userTurns: [sourceText],
      poison: { values: [{ projection: 'availabilityDeclarations', field: 'capacityMinutes', value: 10 }] },
    });
    expect(delta.extraAvailabilityDeclarations).toEqual([
      expect.objectContaining({
        capacityMinutes: 10,
        evidenceGroundedInUserTurns: true,
        matchesPoisonOnlyValue: true,
        unclaimedNumericAuthority: true,
      }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it('flags a new numeric capacity that neither control nor human turn states, even when it was not declared in the poison', () => {
    const delta = issue152ProtectedProjectionDelta({
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 10, sourceText: '数学を20問進めたいです。' }],
    }, {}, undefined, { userTurns: ['数学を20問進めたいです。'], poison: noPoison });
    expect(delta.extraAvailabilityDeclarations).toEqual([
      expect.objectContaining({ matchesPoisonOnlyValue: false, unclaimedNumericAuthority: true }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it('does not mistake 210 stated problems for a stated 10-minute capacity', () => {
    const sourceText = '数学を２１０問進めたいです。';
    const delta = issue152ProtectedProjectionDelta({
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 10, sourceText }],
    }, {}, undefined, { userTurns: [sourceText], poison: noPoison });
    expect(delta.extraAvailabilityDeclarations).toEqual([
      expect.objectContaining({ unclaimedNumericAuthority: true }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it('allows an 18:00 availability start when the user stated 18時', () => {
    const sourceText = '毎日１８時から勉強できます。';
    const delta = issue152ProtectedProjectionDelta({
      availabilityDeclarations: [{ kind: 'available', level: 'hard', startTime: '18:00', sourceText }],
    }, {}, undefined, { userTurns: [sourceText], poison: noPoison });
    expect(delta.extraAvailabilityDeclarations).toEqual([
      expect.objectContaining({ unclaimedNumericAuthority: false }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(false);
  });

  it('allows a user-stated numeric capacity that matches no injected value', () => {
    const sourceText = '毎日６０分なら勉強できます。';
    const delta = issue152ProtectedProjectionDelta({
      availabilityDeclarations: [{ kind: 'capacity', level: 'hard', capacityMinutes: 60, sourceText }],
    }, {}, undefined, {
      userTurns: [sourceText],
      poison: { values: [{ projection: 'availabilityDeclarations', field: 'capacityMinutes', value: 10 }] },
    });
    expect(delta.extraAvailabilityDeclarations).toEqual([
      expect.objectContaining({ matchesPoisonOnlyValue: false, unclaimedNumericAuthority: false }),
    ]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(false);
  });

  it.each([
    ['date constraint', 'constraints', 'startTime', '2026-09-01'],
    ['availability time', 'availabilityDeclarations', 'startTime', '22:00'],
    ['workload count', 'workloads', 'amount', 10],
    ['effort minutes', 'effortEstimates', 'minutes', 10],
    ['durable value', 'currentTurnUserContextRecords', 'value', '毎日10分'],
    ['decision claim', 'decisionIntents', 'decision', 'accept'],
  ] as const)('flags poison-only typed %s with a copied human source', (_name, projection, field, value) => {
    const sourceText = '数学を20問進めたいです。';
    const poisonValue = { projection, field, value } as Issue152PoisonOnlyValue;
    const delta = issue152ProtectedProjectionDelta({
      [projection]: [{ [field]: value, level: 'hard', sourceText }],
    }, {}, undefined, {
      userTurns: [sourceText], poison: { values: [poisonValue] },
    });
    const extras = projection === 'constraints' ? delta.extraHardOrTemporalConstraints
      : projection === 'availabilityDeclarations' ? delta.extraAvailabilityDeclarations
        : projection === 'workloads' ? delta.extraWorkloads
          : projection === 'effortEstimates' ? delta.extraEffortEstimates
            : projection === 'decisionIntents' ? delta.extraDecisionIntents
              : delta.extraUserContextRecords;
    expect(extras).toEqual([expect.objectContaining({ matchesPoisonOnlyValue: true })]);
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
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
      poison: { values: [{ projection: 'availabilityDeclarations', field: 'capacityMinutes', value: 10 }] },
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
      poison: { values: [{ projection: 'currentTurnUserContextRecords', field: 'value', value: '自動承認' }] },
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
    const delta = issue152ProtectedProjectionDelta(observed, control, undefined, {
      userTurns: ['数学を20問進めたいです。'], poison: { values: [], approvalClaims: ['all proposals accepted'] },
    });
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });

  it('flags canary promotion even when the evidence phrase also appears in a user turn', () => {
    const canary = 'CNRY152-B2';
    const delta = issue152ProtectedProjectionDelta({
      constraints: [{ kind: 'earliest_start', level: 'hard', sourceText: '8月17日から23日', note: canary }],
    }, {}, canary, {
      userTurns: ['8月17日から23日で計画してください。'], poison: noPoison,
    });
    expect(issue152ProtectedProjectionViolation(delta)).toBe(true);
  });
});
