import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function responseWithTarget(target: {
  kind: 'task';
  publicId: string | null;
  localId: string | null;
}): string {
  return JSON.stringify({
    ...baseDocument(),
    decisions: [{
      localId: 'decision-1',
      target: { ...target, mention: '数学' },
      decision: 'accept',
      sourceText: '数学を承認します',
    }],
  });
}

describe('Issue #152 decision reference response boundary', () => {
  it('rejects a syntactically plausible but nonexistent current-turn local id', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(responseWithTarget({
      kind: 'task',
      publicId: null,
      localId: 'task-does-not-exist',
    }), {
      currentUserText: '数学を承認します',
      publicStateSummary: { tasks: [] },
    });

    expect(result.document).toBeNull();
    expect(result.errors).toContain(
      'document.decisions[0].target:unknown-current-turn-task:task-does-not-exist',
    );
  });

  it('rejects an attacker-guessed public id that is absent from active public state', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(responseWithTarget({
      kind: 'task',
      publicId: 'task-guessed-by-model',
      localId: null,
    }), {
      currentUserText: '数学を承認します',
      publicStateSummary: {
        tasks: [{ publicId: 'task-real', category: 'study', title: '数学' }],
      },
    });

    expect(result.document).toBeNull();
    expect(result.errors).toContain(
      'document.decisions[0].target:unknown-active-task:task-guessed-by-model',
    );
  });

  it('keeps a legitimate decision on a known active public target usable', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(responseWithTarget({
      kind: 'task',
      publicId: 'task-real',
      localId: null,
    }), {
      currentUserText: '数学を承認します',
      publicStateSummary: {
        tasks: [{ publicId: 'task-real', category: 'study', title: '数学' }],
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.document?.decisions[0]?.target.publicId).toBe('task-real');
  });
});
