import { describe, expect, it } from 'vitest';
import { validateWeeklyPlanningConversationActTargetsAgainstPublicStateV5 } from './weeklyPlanningExistingEntityBindingV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { parseWeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticValidatorV5';
import { hasSelfSufficientConversationActV5 } from './weeklyPlanningConversationActsV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

function document(acts: unknown): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    conversationActs: acts,
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

const publicStateSummary = {
  tasks: [{ publicId: 'task-1', category: 'study', title: '英語' }],
  components: [{ publicId: 'comp-1', taskPublicId: 'task-1', label: '長文', role: 'material' }],
};

describe('conversationActs validation', () => {
  it('accepts every act kind, a missing field, and an empty list', () => {
    for (const kind of [
      'answer_pending_question', 'ask_about_pending_question', 'topic_shift', 'resume_topic', 'consultation_request',
    ]) {
      expect(parseWeeklyPlanningSemanticDocumentV5(document([
        { kind, targetPublicId: null, sourceText: 'x' },
      ])).errors).toEqual([]);
    }
    expect(parseWeeklyPlanningSemanticDocumentV5(document([])).errors).toEqual([]);
    const withoutField = JSON.parse(document([]));
    delete withoutField.conversationActs;
    expect(parseWeeklyPlanningSemanticDocumentV5(JSON.stringify(withoutField)).errors).toEqual([]);
  });

  it('rejects unknown kinds, extra keys, empty evidence, non-arrays and oversized lists', () => {
    const bad = (acts: unknown) => parseWeeklyPlanningSemanticDocumentV5(document(acts)).errors;
    expect(bad([{ kind: 'approve_plan', targetPublicId: null, sourceText: 'x' }])).toContain(
      'document.conversationActs[0].kind:unsupported-value',
    );
    expect(bad([{ kind: 'topic_shift', targetPublicId: null, sourceText: 'x', save: true }])).toContain(
      'document.conversationActs[0]:unknown-key',
    );
    expect(bad([{ kind: 'topic_shift', targetPublicId: null, sourceText: ' ' }])).toContain(
      'document.conversationActs[0].sourceText:expected-non-empty-string',
    );
    expect(bad('topic_shift')).toContain('document.conversationActs:expected-array');
    expect(bad(Array.from({ length: 7 }, () => ({ kind: 'topic_shift', targetPublicId: null, sourceText: 'x' }))))
      .toContain('document.conversationActs:too-many');
  });

  it('requires evidence quoted from the current user turn', () => {
    const run = (sourceText: string) => validateWeeklyPlanningSemanticResponseV5(
      document([{ kind: 'topic_shift', targetPublicId: null, sourceText }]),
      { currentUserText: 'ちょっと数学の話をしたい', publicStateSummary },
    ).errors;
    expect(run('数学の話')).toEqual([]);
    expect(run('こんな発話は存在しない')).toContain(
      'document.conversationActs[0].sourceText:not-grounded-in-current-user-text',
    );
  });

  it('only a self-sufficient act may stand without a planning delta', () => {
    const act = (kind: string) => [{ kind, targetPublicId: null, sourceText: 'x' }] as never;
    expect(hasSelfSufficientConversationActV5(act('answer_pending_question'))).toBe(false);
    expect(hasSelfSufficientConversationActV5(act('topic_shift'))).toBe(true);
    expect(hasSelfSufficientConversationActV5(undefined)).toBe(false);
  });
});

describe('conversationActs target references', () => {
  const doc = (targetPublicId: string | null) => ({
    conversationActs: [{ kind: 'resume_topic', targetPublicId, sourceText: 'x' }],
  }) as unknown as WeeklyPlanningSemanticDocumentV5;
  const check = (targetPublicId: string | null) =>
    validateWeeklyPlanningConversationActTargetsAgainstPublicStateV5({
      document: doc(targetPublicId),
      publicStateSummary,
    });

  it('accepts null, an active task and an active component', () => {
    expect(check(null)).toEqual([]);
    expect(check('task-1')).toEqual([]);
    expect(check('comp-1')).toEqual([]);
  });

  it('rejects an id that is not an active task/component (including removed or superseded ones)', () => {
    expect(check('task-removed')).toEqual([
      'document.conversationActs[0].targetPublicId:unknown-active-target:task-removed',
    ]);
    expect(check('wl-1')).toHaveLength(1);
  });

  it('is reachable through the full response validation as a rejection', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(
      document([{ kind: 'resume_topic', targetPublicId: 'ghost', sourceText: '戻ろう' }]),
      { currentUserText: '英語に戻ろう', publicStateSummary },
    );
    expect(result.document).toBeNull();
    expect(result.errors).toContain(
      'document.conversationActs[0].targetPublicId:unknown-active-target:ghost',
    );
  });
});
