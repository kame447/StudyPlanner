import { describe, expect, it } from 'vitest';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { parseWeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticValidatorV5';
import {
  hasSelfSufficientConversationActV5,
  resolveWeeklyPlanningConversationActTargetsV5,
  sanitizeWeeklyPlanningConversationActsV5,
} from './weeklyPlanningConversationActsV5';

function document(acts: unknown, overrides: Record<string, unknown> = {}): string {
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
    ...overrides,
  });
}

const publicStateSummary = {
  tasks: [{ publicId: 'task-1', category: 'study', title: '英語' }],
  components: [{ publicId: 'comp-1', taskPublicId: 'task-1', label: '長文', role: 'material' }],
};

describe('conversationActs are validated apart from the planning delta', () => {
  it('accepts every act kind, a missing field, and an empty list', () => {
    for (const kind of [
      'answer_pending_question', 'ask_about_pending_question', 'topic_shift', 'resume_topic', 'consultation_request',
    ]) {
      const parsed = parseWeeklyPlanningSemanticDocumentV5(document([{ kind, targetPublicId: null }]));
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.conversationActs).toEqual([{ kind, targetPublicId: null }]);
    }
    expect(parseWeeklyPlanningSemanticDocumentV5(document([])).errors).toEqual([]);
    const withoutField = JSON.parse(document([]));
    delete withoutField.conversationActs;
    expect(parseWeeklyPlanningSemanticDocumentV5(JSON.stringify(withoutField)).errors).toEqual([]);
  });

  it('drops malformed acts (fail closed) without rejecting the planning delta', () => {
    const parsed = parseWeeklyPlanningSemanticDocumentV5(document([
      { kind: 'approve_plan', targetPublicId: null },
      { kind: 'topic_shift', targetPublicId: null, save: true },
      { kind: 'topic_shift', targetPublicId: null, sourceText: 'x' },
      { kind: 'resume_topic', targetPublicId: 7 },
      'topic_shift',
      { kind: 'ask_about_pending_question', targetPublicId: null },
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.conversationActs).toEqual([
      { kind: 'ask_about_pending_question', targetPublicId: null },
    ]);
    expect(parsed.conversationActDiagnostics).toEqual([
      'conversationActs[0]:dropped-unsupported-kind',
      'conversationActs[1]:dropped-unknown-key',
      'conversationActs[2]:dropped-unknown-key',
      'conversationActs[3]:dropped-malformed-target',
      'conversationActs[4]:dropped-not-object',
    ]);
  });

  it('ignores a non-array or oversized act list as a whole', () => {
    expect(sanitizeWeeklyPlanningConversationActsV5('topic_shift')).toEqual({
      acts: [], diagnostics: ['conversationActs:ignored-not-array'],
    });
    const many = Array.from({ length: 7 }, () => ({ kind: 'topic_shift', targetPublicId: null }));
    expect(sanitizeWeeklyPlanningConversationActsV5(many)).toEqual({
      acts: [], diagnostics: ['conversationActs:ignored-too-many'],
    });
  });

  it('keeps valid acts even when the planning delta is rejected, and never accepts that delta', () => {
    const invalidPlanning = document(
      [{ kind: 'ask_about_pending_question', targetPublicId: null }],
      { tasks: [{ localId: 'x' }] },
    );
    const result = validateWeeklyPlanningSemanticResponseV5(invalidPlanning, {
      currentUserText: 'なんで時間が必要なの？', publicStateSummary,
    });
    expect(result.document).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes('conversationActs'))).toBe(false);
    expect(result.conversationActs).toEqual([{ kind: 'ask_about_pending_question', targetPublicId: null }]);
    expect(result.planningContentPresent).toBe(true);
  });

  it('needs no quoted evidence: the act belongs to the current turn by construction', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(
      document([{ kind: 'ask_about_pending_question', targetPublicId: null }]),
      { currentUserText: 'なんで時間が必要なの？', publicStateSummary },
    );
    expect(result.errors).toEqual([]);
    expect(result.document?.conversationActs).toHaveLength(1);
    expect(result.planningContentPresent).toBe(false);
  });

  it('only a self-sufficient act may stand without a planning delta', () => {
    const act = (kind: string) => [{ kind, targetPublicId: null }] as never;
    expect(hasSelfSufficientConversationActV5(act('answer_pending_question'))).toBe(false);
    expect(hasSelfSufficientConversationActV5(act('topic_shift'))).toBe(true);
    expect(hasSelfSufficientConversationActV5(act('ask_about_pending_question'))).toBe(true);
    expect(hasSelfSufficientConversationActV5(undefined)).toBe(false);
  });
});

describe('conversationActs topic references', () => {
  const resolve = (targetPublicId: string | null) => resolveWeeklyPlanningConversationActTargetsV5({
    acts: [{ kind: 'resume_topic', targetPublicId }],
    publicStateSummary,
  });

  it('keeps null, an active task and an active component', () => {
    expect(resolve(null).acts[0].targetPublicId).toBeNull();
    expect(resolve('task-1').acts[0].targetPublicId).toBe('task-1');
    expect(resolve('comp-1').acts[0].targetPublicId).toBe('comp-1');
    expect(resolve('task-1').diagnostics).toEqual([]);
  });

  it('degrades an id that is not an active task/component to "no topic" instead of rejecting', () => {
    for (const id of ['task-removed', 'wl-1', 'wpf_uncertainty_1']) {
      expect(resolve(id)).toEqual({
        acts: [{ kind: 'resume_topic', targetPublicId: null }],
        diagnostics: ['conversationActs[0].targetPublicId:degraded-unknown-topic'],
      });
    }
  });

  it('applies through the full response validation without a planning error', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(
      document([{ kind: 'resume_topic', targetPublicId: 'ghost' }]),
      { currentUserText: '英語に戻ろう', publicStateSummary },
    );
    expect(result.errors).toEqual([]);
    expect(result.document?.conversationActs).toEqual([{ kind: 'resume_topic', targetPublicId: null }]);
    expect(result.conversationActDiagnostics).toEqual([
      'conversationActs[0].targetPublicId:degraded-unknown-topic',
    ]);
  });
});

describe('pending work-breakdown question and a turn without planning content', () => {
  const pendingBreakdown = {
    pendingQuestion: { questionCode: 'semantic_uncertainty', targetFactId: 'unc-1', graphRevision: 1 },
    tasks: [{ publicId: 'task-1', category: 'study', title: '数学' }],
    uncertainties: [{ publicId: 'unc-1', targetPublicId: 'task-1', field: 'work_breakdown', reason: 'r', sourceText: 's' }],
  };

  it('interaction: an explanation-only response need not restate the breakdown target', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(
      document([{ kind: 'ask_about_pending_question', targetPublicId: 'unc-1' }]),
      { currentUserText: 'なんで時間が必要なの？', publicStateSummary: pendingBreakdown, conversationArchitecture: 'interaction_v1' },
    );
    expect(result.errors).toEqual([]);
    expect(result.document?.conversationActs).toEqual([{ kind: 'ask_about_pending_question', targetPublicId: null }]);
  });

  it('interaction: a response that does carry planning content must still represent the target', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(
      document([], {
        planningIntent: 'update_plan',
        uncertainties: [{ localId: 'u', targetLocalId: 'document', field: 'scope', reason: 'r', sourceText: 'なんで' }],
      }),
      { currentUserText: 'なんで時間が必要なの？', publicStateSummary: pendingBreakdown, conversationArchitecture: 'interaction_v1' },
    );
    expect(result.errors).toContain('document:work-breakdown-target-task-required:target=task-1');
  });

  it('legacy keeps the pre-#488 contract (acts are an unknown key; empty documents restate the target)', () => {
    const legacy = (raw: string) => validateWeeklyPlanningSemanticResponseV5(raw, {
      currentUserText: 'なんで時間が必要なの？', publicStateSummary: pendingBreakdown, conversationArchitecture: 'legacy_v5',
    });
    const withoutActs = JSON.parse(document([]));
    delete withoutActs.conversationActs;
    expect(legacy(JSON.stringify(withoutActs)).errors).toEqual([
      'document:work-breakdown-target-task-required:target=task-1',
    ]);
    expect(legacy(document([])).errors).toContain('document.unknown-key:conversationActs');
  });
});
