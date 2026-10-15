import { describe, expect, it } from 'vitest';
import { captureNumericPendingQuestionDomainV5, isNumericPendingQuestionDomainCurrentV5 } from './weeklyPlanningNumericPendingDomainV5';
import { numericFixture } from './weeklyPlanningNumericPendingChoiceV5.testUtils';

function basis() {
  const fixture = numericFixture();
  fixture.input.userText = '数学の問題を10問進めたい';
  return { fixture, value: { input: fixture.input, state: fixture.state,
    domainMinutes: [1, 2, 3, 5, 10, 30], domainPolicyVersion: 'fixture-question-domain-v1',
    presentedQuestion: { assistantMessageId: fixture.state.binding.question.presentingMessageId, text: '数学の問題は1問に何分かかりますか？' } } };
}
describe('D5 question-time finite domain', () => {
  it('freezes complete target/measurement/scope/domain before the answer and permits a new request ID only', () => {
    const { fixture, value } = basis();
    const snapshot = captureNumericPendingQuestionDomainV5(value)!;
    expect(snapshot).not.toBeNull();
    expect(Object.isFrozen(snapshot.domainMinutes)).toBe(true);
    expect(Object.isFrozen(snapshot.binding.scope)).toBe(true);
    expect(snapshot).toMatchObject({ measurement: 'total_duration', perUnit: null, domainMinutes: [1, 2, 3, 5, 10, 30] });
    fixture.input.userText = '3分です';
    fixture.input.traceRequestId = 'request-answer';
    const next = { ...fixture.state, binding: { ...fixture.state.binding, requestId: 'request-answer' } };
    expect(isNumericPendingQuestionDomainCurrentV5(snapshot, { ...value, state: next })).toBe(true);
    value.domainMinutes.push(60);
    expect(snapshot.domainMinutes).toEqual([1, 2, 3, 5, 10, 30]);
    expect(isNumericPendingQuestionDomainCurrentV5(snapshot, { ...value, state: next })).toBe(false);
  });
  it.each([[], [0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], [1, 1], Array.from({ length: 255 }, (_, i) => i + 1)].map(domain => [domain] as const))(
    'rejects an unsupported finite domain %j', domainMinutes => {
      expect(captureNumericPendingQuestionDomainV5({ ...basis().value, domainMinutes })).toBeNull();
    },
  );
  it.each(['policy', 'measurement', 'perUnit', 'owner', 'conversation', 'epoch', 'question', 'presentation', 'body', 'scope', 'task label', 'workload unit label', 'graph revision'])(
    'rejects %s drift after question time', axis => {
      const { fixture, value } = basis(); const snapshot = captureNumericPendingQuestionDomainV5(value)!;
      const state = structuredClone(fixture.state);
      if (axis === 'policy') value.domainPolicyVersion = 'fixture-v2';
      if (axis === 'measurement') Object.assign(state, { measurement: 'duration_per_unit' });
      if (axis === 'perUnit') Object.assign(state, { perUnit: 'problem' });
      if (axis === 'owner') Object.assign(state.binding, { ownerId: 'other-owner' });
      if (axis === 'conversation') Object.assign(state.binding, { conversationId: 'other-conversation' });
      if (axis === 'epoch') Object.assign(state.binding, { selectionEpoch: 3 });
      if (axis === 'question') Object.assign(state.binding.question, { id: 'other-question' });
      if (axis === 'presentation') Object.assign(state.binding.question, { presentingMessageId: 'new-message' });
      if (axis === 'body') value.presentedQuestion.text = '別の教材の合計時間は何分ですか？';
      if (axis === 'scope') Object.assign(state.binding.scope, { amount: 11 });
      if (axis === 'task label') fixture.graph.tasks[0].title = '物理';
      if (axis === 'workload unit label') fixture.graph.workloads[0].unitLabel = 'ページ';
      if (axis === 'graph revision') fixture.graph.revision += 1;
      expect(isNumericPendingQuestionDomainCurrentV5(snapshot, { ...value, state })).toBe(false);
    },
  );
  it.each(['ownerId', 'conversationId', 'requestId', 'selectionEpoch', 'inputRevision'])(
    'uses the existing strict CandidateBinding validator for %s', field => {
      const { value } = basis();
      Object.assign(value.state.binding, { [field]: ['invalid'] });
      expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
    },
  );
  it('rejects malicious or deserialized snapshot getters rather than invoking them', () => {
    const { value } = basis(); let reads = 0;
    const forged = Object.defineProperty({}, 'binding', { enumerable: true, get() { reads++; throw new Error('getter'); } });
    expect(isNumericPendingQuestionDomainCurrentV5(forged as never, value)).toBe(false);
    expect(reads).toBe(0);
  });
  it('does not trust a one-target count when the actual graph has a second active workload', () => {
    const { fixture, value } = basis();
    fixture.graph.workloads.push({ ...fixture.graph.workloads[0], id: 'second-workload' });
    fixture.graph.factLifecycles.push({ ...fixture.graph.factLifecycles[0], factId: 'second-workload' });
    expect(value.state.pendingTargetCount).toBe(1);
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  it('never replaces an existing active effort estimate under a stale missing-effort question', () => {
    const { fixture, value } = basis();
    fixture.graph.effortEstimates.push({ id: 'existing-effort', taskId: 'task-1', targetFactId: 'workload-1',
      kind: 'total_duration', minutes: 20, unitCode: null, precision: 'exact', source: fixture.graph.tasks[0].source, createdRevision: 2 });
    fixture.graph.factLifecycles.push({ ...fixture.graph.factLifecycles[0], factId: 'existing-effort', createdRevision: 2 });
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  it('does not accept a legacy absent question record', () => {
    expect(isNumericPendingQuestionDomainCurrentV5(null, basis().value)).toBe(false);
    expect(captureNumericPendingQuestionDomainV5({ ...basis().value, presentedQuestion: null })).toBeNull();
  });
});
