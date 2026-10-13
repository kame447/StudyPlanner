import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
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

it('keeps one captured pre-hypothesis I response equivalent to explicit null at the same validator', () => {
  const captured = JSON.parse(readFileSync(new URL('../testUtils/__tests__/weeklyPlanningCapturedEventRegistration.json', import.meta.url), 'utf8'));
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  expect(sha256(captured.modelOutput)).toBe(captured.provenance.modelOutputSha256);
  expect(sha256(captured.semanticPayload)).toBe(captured.provenance.semanticPayloadSha256);
  const payload = JSON.parse(captured.semanticPayload);
  const input = { currentUserText: payload.userText, supplementalContext: payload.supplementalContext ?? undefined,
    selectedStarterTarget: payload.selectedStarterTarget ?? undefined,
    recentConversation: payload.recentConversation, publicStateSummary: payload.publicStateSummary };
  const oldDocument = JSON.parse(captured.modelOutput);
  expect(oldDocument.conversationActs).toEqual([{ kind: 'request_event_registration', targetPublicId: null }]);
  const original = validateWeeklyPlanningSemanticResponseV5(captured.modelOutput, input);
  const withNull = validateWeeklyPlanningSemanticResponseV5(JSON.stringify({ ...oldDocument,
    conversationActs: oldDocument.conversationActs.map((act: Record<string, unknown>) => ({ ...act, placementAlternative: null })),
  }), input);
  expect(original.errors).toEqual([]); expect(original.document).not.toBeNull();
  expect(withNull.errors).toEqual([]); expect(withNull.document).toEqual(original.document);
  expect(withNull.algorithmicRepairs).toEqual(original.algorithmicRepairs);
  expect(original.document!.conversationActs).toEqual(oldDocument.conversationActs);
});
