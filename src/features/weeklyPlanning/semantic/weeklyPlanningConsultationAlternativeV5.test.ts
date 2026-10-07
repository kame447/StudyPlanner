import { describe, expect, it } from 'vitest';
import { parseWeeklyPlanningConsultationAlternativeV5 } from './weeklyPlanningConsultationAlternativeV5';
import { sanitizeWeeklyPlanningConversationActsV5, resolveWeeklyPlanningConversationActTargetsV5 } from './weeklyPlanningConversationActsV5';

const alternative = { scope: 'task', dateExpressions: ['weekday:saturday', 'weekday:sunday'], sourceText: '土日はどう？' };
describe('a consultation hypothesis is typed, bounded and non-authoritative', () => {
  it('keeps canonical dates without turning a hypothesis into a planning fact', () => {
    expect(parseWeeklyPlanningConsultationAlternativeV5(alternative)).toEqual(alternative);
    const act = { kind: 'consultation_request', targetPublicId: 'task', placementAlternative: alternative };
    expect(sanitizeWeeklyPlanningConversationActsV5([act])).toEqual({ acts: [act], diagnostics: [] });
  });
  it.each([
    { dateExpressions: ['土日'] }, { dateExpressions: ['custom:土曜日'] }, { dateExpressions: ['2026-02-30'] },
    { dateExpressions: [] }, { dateExpressions: Array(8).fill('weekday:saturday') },
    { scope: 'component' }, { sourceText: '' }, { approve: true },
  ])('retains unavailable evidence for a malformed hypothesis: %j', delta => {
    expect(parseWeeklyPlanningConsultationAlternativeV5({ ...alternative, ...delta })).toBeNull();
    const result = sanitizeWeeklyPlanningConversationActsV5([{ kind: 'consultation_request', targetPublicId: 'task', placementAlternative: { ...alternative, ...delta } }]);
    expect(result.acts).toEqual([{ kind: 'consultation_request', targetPublicId: 'task', placementAlternative: { unavailable: 'malformed' } }]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it('does not attach a hypothetical placement to a non-consultation act', () => {
    expect(sanitizeWeeklyPlanningConversationActsV5([{ kind: 'resume_topic', targetPublicId: 'task', placementAlternative: alternative }]).acts)
      .toEqual([{ kind: 'resume_topic', targetPublicId: 'task' }]);
  });
  it('does not broaden an unresolved target into a plan-wide hypothetical query', () => {
    expect(resolveWeeklyPlanningConversationActTargetsV5({
      acts: [{ kind: 'consultation_request', targetPublicId: 'old-task', placementAlternative: { ...alternative, scope: 'task' } }],
      publicStateSummary: { tasks: [{ publicId: 'other-task' }] },
    }).acts).toEqual([{ kind: 'consultation_request', targetPublicId: null, placementAlternative: { unavailable: 'unknown_target' } }]);
  });
});
