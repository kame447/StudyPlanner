import { describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningAvailability } from './weeklyPlanningAvailabilityResolver';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { createTemporalDateBasisV5 } from './weeklyPlanningTemporalDateChoiceV5';

import { temporalDateFixtureV5 as fixture } from './weeklyPlanningTemporalDateChoiceV5.testUtils';
import { createWeeklyPlanningAvailabilityResolverGraphV5 } from './weeklyPlanningSchedulerAvailabilityProjectionV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { decideWeeklyPlanningStableDialogueV5 } from './weeklyPlanningStableDialoguePolicyV5';
import { projectStableV5CompatibilityState } from '../application/weeklyPlanningStableV5CompatibilityState';
import { renderStableV5RuntimeQuestion } from '../application/weeklyPlanningStableV5RuntimeQuestions';
import { bindWeeklyPlanningQuestionPresentation } from '../intake/weeklyPlanningQuestionPresentation';
import { createStableV5SemanticPublicStateSummary } from '../application/weeklyPlanningStableV5SemanticContext';

describe('D5prime single-date closure', () => {
  it('reaches the real date-scope issue from a validated normal provider document', () => {
    const { graph } = fixture();
    const context = { ownerId: 'owner', currentDate: '2026-10-05', planningStartDate: '2026-10-05', planningEndDate: '2026-10-11', timeZone: 'Asia/Tokyo' };
    const result = resolveWeeklyPlanningAvailability({ graph: createWeeklyPlanningAvailabilityResolverGraphV5(graph), context, resolvedDateExpressions: resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate: context.currentDate }) });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_availability_date_scope', sourceFactId: graph.availabilityDeclarations[0].id, blocking: true }));
  });
  it('constructs seven complete date leaves without inspecting the answer text', () => {
    const f = fixture();
    const basis = createTemporalDateBasisV5({ input: f.input, binding: f.binding, calendar: f.calendar, domainPolicyVersion: f.domainPolicyVersion });
    expect(basis?.candidates).toHaveLength(7);
    expect(basis?.candidates.map(c => c.tuple.dateExpression)).toEqual(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
    expect(createTemporalDateBasisV5({ input: { ...f.input, userText: '変更も保存も全部お願い' }, binding: f.binding, calendar: f.calendar, domainPolicyVersion: f.domainPolicyVersion })).toEqual(basis);
  });
  it('preserves the date target through real compilation, dialogue ordering and displayed-question state', () => {
    const f = fixture();
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(f.graph),
      context: { ownerId: 'owner', currentDate: '2026-10-05', planningStartDate: '2026-10-05', planningEndDate: '2026-10-11', timeZone: 'Asia/Tokyo' } });
    const dialogue = decideWeeklyPlanningStableDialogueV5(compilation);
    expect(dialogue.status).toBe('ask_question');
    if (dialogue.status !== 'ask_question') throw new Error('Expected a date question');
    expect(dialogue.question).toMatchObject({ code: 'missing_availability_date_scope', factId: f.target.id });
    const questionState = projectStableV5CompatibilityState({ userText: f.target.source.sourceText,
      message: renderStableV5RuntimeQuestion(f.graph, dialogue.question), draftCandidates: [], authorized: false,
      questionCode: dialogue.question.code, questionFactId: dialogue.question.factId!, questionActionId: f.binding.question.id });
    const presented = bindWeeklyPlanningQuestionPresentation({ state: questionState,
      turnId: f.binding.question.presentingTurnId, assistantMessageId: f.binding.question.presentingMessageId,
      planningStateRevision: f.binding.inputRevision, graphRevision: f.graph.revision,
      content: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none', selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } });
    const messages = [{ id: f.binding.question.presentingMessageId, role: 'assistant' as const,
      content: questionState.questions[0], createdAt: '2026-10-05T00:00:00Z' }];
    const summary = createStableV5SemanticPublicStateSummary({ graph: f.graph, messages, previousState: presented, inputStateRevision: f.binding.inputRevision });
    expect(summary.pendingQuestion).toMatchObject({ questionCode: 'missing_availability_date_scope', targetFactId: f.target.id, actionId: f.binding.question.id });
    expect(createTemporalDateBasisV5({ ...f, input: { ...f.input, publicStateSummary: summary } })?.candidates).toHaveLength(7);
    const stale = createStableV5SemanticPublicStateSummary({ graph: f.graph, messages, previousState: presented, inputStateRevision: f.binding.inputRevision + 1 });
    expect(stale.pendingQuestion).toBeNull();
    expect(createTemporalDateBasisV5({ ...f, input: { ...f.input, publicStateSummary: stale } })).toBeNull();
  });
  it.each(['recurring', 'missing end', '24:00', 'same clocks', 'named period', 'capacity', 'existing date', 'inactive', 'wide horizon'])(
    'excludes %s rather than rounding or changing the question scope', kind => {
      const f = fixture();
      if (kind === 'recurring') f.target.recurrenceKind = 'daily';
      if (kind === 'missing end') f.target.endTime = null;
      if (kind === '24:00') f.target.endTime = '24:00';
      if (kind === 'same clocks') f.target.endTime = '18:00';
      if (kind === 'named period') f.target.namedTimePeriod = 'night';
      if (kind === 'capacity') f.target.kind = 'capacity';
      if (kind === 'existing date') f.target.dateExpression = '2026-10-07';
      if (kind === 'inactive') f.graph.factLifecycles.find(e => e.factId === f.target.id)!.status = 'superseded';
      if (kind === 'wide horizon') { f.graph.planningWindows[0].end = '2026-10-20'; f.graph.planningWindows[0].value = '2026-10-05/2026-10-20'; }
      expect(createTemporalDateBasisV5({ input: f.input, binding: f.binding, calendar: f.calendar, domainPolicyVersion: f.domainPolicyVersion })).toBeNull();
    },
  );
  it('distinguishes fixed clock/polarity/calendar/source targets using the same reply', () => {
    const first = fixture(); const basis = createTemporalDateBasisV5({ input: first.input, binding: first.binding, calendar: first.calendar, domainPolicyVersion: first.domainPolicyVersion })!;
    const variants = [fixture(), fixture(), fixture(), fixture()];
    variants[0].target.startTime = '17:00';
    variants[1].target.kind = 'available';
    variants[2].calendar.timeZone = 'UTC';
    variants[3].target.id = 'another-availability';
    const oldId = variants[3].binding.target.id;
    variants[3].graph.factLifecycles.find(entry => entry.factId === oldId)!.factId = variants[3].target.id;
    variants[3].input.publicStateSummary.pendingQuestion.targetFactId = variants[3].target.id;
    variants[3].binding.target.id = variants[3].target.id;
    for (const variant of variants) {
      const changed = createTemporalDateBasisV5({ input: variant.input, binding: variant.binding, calendar: variant.calendar, domainPolicyVersion: variant.domainPolicyVersion });
      expect(changed).not.toBeNull(); expect(changed).not.toEqual(basis);
    }
  });

});
