import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createWeeklyPlanningStableV5DialoguePrompt } from '../dialogue/weeklyPlanningStableV5DialoguePrompt';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  classifyWeeklyPlanningInteraction,
  type WeeklyPlanningInteractionPlan,
} from './weeklyPlanningInteractionDecision';

const question: WeeklyPlanningQuestionContext = {
  kind: 'missing',
  targetSlot: 'stable_v5:missing_effort_estimate',
  intent: 'duration_per_unit',
  topicId: 'wl-1',
};
const fresh: WeeklyPlanningQuestionPresentationFreshness = {
  status: 'fresh',
  questionContext: question,
  presentation: {
    version: 1, turnId: 't', assistantMessageId: 'a', planningStateRevision: 2, graphRevision: 1,
    content: {
      responseSource: 'deterministic_fallback', currentTurnGrounding: 'none', selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false,
    },
  },
};

function plan(overrides: Partial<WeeklyPlanningInteractionPlan['acts']> = {}, targetQuestionOpen = false): WeeklyPlanningInteractionPlan {
  return {
    dialogueQuestionOverride: null,
    targetQuestionOpen,
    acts: { ask: false, shift: false, resume: false, consultation: false, ...overrides },
  };
}

function output(options: { question?: WeeklyPlanningQuestionContext; draft?: boolean } = {}): WeeklyPlanningTurnExecutionResult {
  return {
    state: { ...createInitialPlanningIntakeState(), lastQuestionContext: options.question },
    message: 'm',
    draftCandidates: options.draft ? [{} as never] : [],
  };
}

const classify = (
  p: WeeklyPlanningInteractionPlan,
  out: WeeklyPlanningTurnExecutionResult,
  presentation: WeeklyPlanningQuestionPresentationFreshness = fresh,
) => classifyWeeklyPlanningInteraction({ plan: p, output: out, previousQuestion: question, presentation });

describe('interaction outcome classification (typed acts + machine state only)', () => {
  it('explains only a fresh pending question that is unchanged', () => {
    expect(classify(plan({ ask: true }), output({ question })).kind).toBe('explain_pending_question');
    expect(classify(plan({ ask: true }), output({ question }), { status: 'unbound' }).kind).toBe('apply');
    expect(classify(plan({ ask: true }), output({ question: { ...question, topicId: 'wl-2' } })).kind).toBe('apply');
    expect(classify(plan({ ask: true }), output()).kind).toBe('apply');
  });

  it('treats a topic shift as an aside unless the named topic has an open question', () => {
    expect(classify(plan({ shift: true }), output({ question })).kind).toBe('aside');
    expect(classify(plan({ shift: true }, true), output({ question })).kind).toBe('resume_pending_question');
  });

  it('resumes only when there is a question to re-present', () => {
    expect(classify(plan({ resume: true }), output({ question })).kind).toBe('resume_pending_question');
    expect(classify(plan({ resume: true }), output()).kind).toBe('apply');
  });

  it('never lets an act suppress a preview, and keeps the consultation marker', () => {
    const outcome = classify(plan({ shift: true, ask: true, consultation: true }), output({ question, draft: true }));
    expect(outcome).toEqual({ kind: 'apply', consultationDeferred: true });
  });

  it('keeps independent contributions: an explanation can carry a consultation marker', () => {
    expect(classify(plan({ ask: true, consultation: true }), output({ question }))).toEqual({
      kind: 'explain_pending_question',
      consultationDeferred: true,
    });
  });
});

describe('renderer boundary', () => {
  it('receives the typed outcome and does not ask the model to infer it from the user message', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'a', currentUserMessage: 'なんで時間が必要？', recentConversation: [], planningInformation: null,
      actionKind: 'question', questionCode: 'missing_effort_estimate', requiredLabels: [], fallbackText: 'f', previewCount: 0,
      conversationOutcome: 'explain_pending_question', consultationDeferred: true,
    });
    const payload = JSON.parse(prompt.userPrompt) as { applicationDecision: Record<string, unknown>; request: string };
    expect(payload.applicationDecision).toMatchObject({
      conversationOutcome: 'explain_pending_question',
      consultationDeferred: true,
    });
    expect(payload.request).not.toContain('currentUserMessageが直前の質問の意味');
    expect(payload.request).toContain('currentUserMessageからこの扱いを推測し直さない');
  });

  it('decision modules never read raw user text', () => {
    for (const file of ['./weeklyPlanningInteractionDecision.ts', './weeklyPlanningConversationRecovery.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\.userText\b(?!\s*,|\s*\}|\s*:)/);
      expect(source).not.toMatch(/RegExp|\.match\(|\.test\(/);
    }
  });
});
