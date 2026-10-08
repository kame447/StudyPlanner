import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { fixedEventOnlyInteractionStatus, scheduleCommunicationIntent } from './weeklyPlanningFixedEventOnlyInteraction';

describe('fixed-event presentation boundary', () => {
  it.each([
    { categories: [], purpose: 'clarify_schedule_request' },
    { categories: ['non_study'], purpose: 'register_event' },
    { categories: ['study'], purpose: 'identify_study_work' },
    { categories: ['non_study', 'study'], purpose: 'identify_study_work' },
  ] as const)('uses the accepted subject for the optional question purpose: $purpose ($categories)', ({ categories, purpose }) => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = categories.map((category, index) => ({ id: `task-${index}`, category, title: `label-${index}`, createdRevision: 0,
      source: { conversationId: 'conversation', turnId: 'turn', semanticLocalId: `task-${index}`, sourceText: `label-${index}`, origin: 'user' as const },
    }));
    graph.factLifecycles = graph.tasks.map(task => ({ factId: task.id, status: 'active', createdRevision: 0, terminalRevision: null, supersededByFactId: null }));
    expect(scheduleCommunicationIntent(createWeeklyPlanningActiveSchedulerGraphViewV5(graph))).toBe(purpose);
    if (categories.length > 0) expect(fixedEventOnlyInteractionStatus({ architecture: 'interaction_v1', graph,
      compilation: { status: 'empty', input: null, issues: [] }, semanticChanged: false, previousQuestionSlot: 'stable_v5:missing_schedulable_work',
      declinedAdditionalWork: true, requestedEventRegistration: true })).toBeNull();
  });

  it('allows a typed event request in a resolved empty state, then keeps the question closed', () => {
    const input = { architecture: 'interaction_v1' as const, graph: createEmptyWeeklyPlanningFactGraphV5(),
      compilation: { status: 'empty' as const, input: null, issues: [] }, semanticChanged: false,
      previousQuestionSlot: undefined, declinedAdditionalWork: false };
    expect(fixedEventOnlyInteractionStatus({ ...input, requestedEventRegistration: true })).toBe('fixed_event_manual_entry');
    expect(fixedEventOnlyInteractionStatus({ ...input, previousOptionalInvitationClosed: true })).toBe('no_additional_work');
    expect(fixedEventOnlyInteractionStatus({ ...input, requestedEventRegistration: true, compilation: { ...input.compilation, status: 'needs_resolution' } })).toBeNull();
  });

  it('does not turn an ordinary empty plan or a legacy request into an event handoff', () => {
    for (const architecture of ['legacy_v5', 'interaction_v1'] as const) {
      expect(fixedEventOnlyInteractionStatus({ architecture, graph: createEmptyWeeklyPlanningFactGraphV5(), compilation: { status: 'empty', input: null, issues: [] },
        semanticChanged: false, previousQuestionSlot: 'stable_v5:missing_schedulable_work', declinedAdditionalWork: true })).toBeNull();
    }
  });
});
