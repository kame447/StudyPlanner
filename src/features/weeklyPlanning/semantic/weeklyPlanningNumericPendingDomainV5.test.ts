import { describe, expect, it } from 'vitest';
import { captureNumericPendingQuestionDomainV5, isNumericPendingQuestionDomainCurrentV5 } from './weeklyPlanningNumericPendingDomainV5';
import { numericFixture } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

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
  const graphOf = (fixture: ReturnType<typeof basis>['fixture']): WeeklyPlanningFactGraphV5 => fixture.graph;
  function withSecondWorkload(fixture: ReturnType<typeof basis>['fixture'], patch: Record<string, unknown> = {}) {
    graphOf(fixture).tasks.push({ ...graphOf(fixture).tasks[0], id: 'task-2', title: '英語' });
    graphOf(fixture).workloads.push({ ...graphOf(fixture).workloads[0], id: 'second-workload', taskId: 'task-2', ...patch });
    graphOf(fixture).factLifecycles.push(...['task-2', 'second-workload'].map(factId => ({ ...graphOf(fixture).factLifecycles[0], factId })));
  }
  function effort(fixture: ReturnType<typeof basis>['fixture'], id: string, taskId: string, targetFactId: string, status: 'active' | 'superseded' = 'active') {
    graphOf(fixture).effortEstimates.push({ id, taskId, targetFactId, kind: 'total_duration', minutes: 20, unitCode: null,
      precision: 'exact', source: graphOf(fixture).tasks[0].source, createdRevision: 2 });
    graphOf(fixture).factLifecycles.push({ ...graphOf(fixture).factLifecycles[0], factId: id, status, createdRevision: 2,
      terminalRevision: status === 'active' ? null : 2 });
  }
  it.each([
    ['an active estimate on that workload', (f: ReturnType<typeof basis>['fixture']) => effort(f, 'other-effort', 'task-2', 'second-workload')],
    ['an active task-level estimate', (f: ReturnType<typeof basis>['fixture']) => effort(f, 'other-effort', 'task-2', 'task-2')],
  ])('captures one pending target when the other active workload is settled by %s', (_label, settle) => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture);
    settle(fixture);
    expect(captureNumericPendingQuestionDomainV5(value)).not.toBeNull();
  });
  it.each(['minute', 'hour'] as const)('captures one pending target beside an intrinsic %s workload', unitCode => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture, { unitCode, unitLabel: unitCode === 'minute' ? '分' : '時間', amount: 30 });
    expect(captureNumericPendingQuestionDomainV5(value)).not.toBeNull();
  });
  it.each([
    ['has no estimate', () => undefined],
    ['has only a superseded estimate', (f: ReturnType<typeof basis>['fixture']) => effort(f, 'old-effort', 'task-2', 'second-workload', 'superseded')],
    ['has an estimate for a different task only', (f: ReturnType<typeof basis>['fixture']) => effort(f, 'foreign-effort', 'task-1', 'second-workload')],
  ])('rejects a second open target when the other active workload %s', (_label, settle) => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture);
    settle(fixture);
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  it('rejects a second open workload under the same task', () => {
    const { fixture, value } = basis();
    graphOf(fixture).workloads.push({ ...graphOf(fixture).workloads[0], id: 'sibling-workload', unitCode: 'page', unitLabel: 'ページ' });
    graphOf(fixture).factLifecycles.push({ ...graphOf(fixture).factLifecycles[0], factId: 'sibling-workload' });
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  function perUnitEffort(fixture: ReturnType<typeof basis>['fixture'], unitCode: 'problem' | 'page') {
    graphOf(fixture).effortEstimates.push({ id: 'per-unit-effort', taskId: 'task-2', targetFactId: 'second-workload', kind: 'duration_per_unit',
      minutes: 3, unitCode, precision: 'exact', source: graphOf(fixture).tasks[0].source, createdRevision: 2 });
    graphOf(fixture).factLifecycles.push({ ...graphOf(fixture).factLifecycles[0], factId: 'per-unit-effort', createdRevision: 2 });
  }
  it('treats a sibling as settled only when the planner resolver resolves its matching per-unit estimate', () => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture);
    perUnitEffort(fixture, 'problem');
    expect(captureNumericPendingQuestionDomainV5(value)).not.toBeNull();
  });
  it('rejects a sibling whose only estimate is per-unit in a mismatched unit, which the planner leaves open', () => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture);
    perUnitEffort(fixture, 'page');
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  it('rejects a sibling whose covering estimates are ambiguous to the planner', () => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture);
    effort(fixture, 'other-effort-a', 'task-2', 'second-workload');
    effort(fixture, 'other-effort-b', 'task-2', 'second-workload');
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  it('rejects a scope_total sibling, which the planner never resolves as a planning workload', () => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture, { quantityRole: 'scope_total' });
    effort(fixture, 'other-effort', 'task-2', 'second-workload');
    expect(captureNumericPendingQuestionDomainV5(value)).toBeNull();
  });
  it('re-derives the pending count at answer time when a settled workload loses its estimate', () => {
    const { fixture, value } = basis();
    withSecondWorkload(fixture);
    effort(fixture, 'other-effort', 'task-2', 'second-workload');
    const snapshot = captureNumericPendingQuestionDomainV5(value)!;
    expect(isNumericPendingQuestionDomainCurrentV5(snapshot, value)).toBe(true);
    graphOf(fixture).factLifecycles.find(entry => entry.factId === 'other-effort')!.status = 'superseded';
    expect(isNumericPendingQuestionDomainCurrentV5(snapshot, value)).toBe(false);
  });
  it('never answers a target already covered by a task-level estimate', () => {
    const { fixture, value } = basis();
    effort(fixture, 'task-effort', 'task-1', 'task-1');
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
