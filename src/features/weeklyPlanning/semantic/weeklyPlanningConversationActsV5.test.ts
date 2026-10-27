import { expect, it } from 'vitest';
import { resolveWeeklyPlanningConversationActTargetsV5 } from './weeklyPlanningConversationActsV5';

it.each([
  ['request_event_registration', 'unresolved'], ['resume_topic', 'unresolved'],
  ['answer_pending_question', undefined], ['ask_about_pending_question', undefined],
  ['topic_shift', undefined], ['decline_additional_work', undefined],
] as const)('keeps unknown %s targets distinct where required, without changing known or explicit-null targets', (kind, resolution) => {
  const result = resolveWeeklyPlanningConversationActTargetsV5({ publicStateSummary: { tasks: [{ publicId: 'known-task' }] },
    acts: [{ kind, targetPublicId: 'missing-task' }, { kind, targetPublicId: null }, { kind, targetPublicId: 'known-task' }] });
  expect(result.acts[0]).toMatchObject({ kind, targetPublicId: null });
  expect(result.acts[0].targetResolution).toBe(resolution);
  expect(result.acts.slice(1)).toEqual([{ kind, targetPublicId: null }, { kind, targetPublicId: 'known-task' }]);
  expect(result.diagnostics).toEqual(['conversationActs[0].targetPublicId:degraded-unknown-topic']);
});
