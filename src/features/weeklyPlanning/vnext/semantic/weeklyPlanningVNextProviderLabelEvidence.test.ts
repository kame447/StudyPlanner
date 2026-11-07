import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningVNextState } from '../weeklyPlanningVNextState';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { applyWeeklyPlanningVNextTurn } from './weeklyPlanningVNextTransaction';
import { validateVNextProviderLabelEvidence } from './weeklyPlanningVNextProviderLabelEvidence';

const delta = (add: VNextAddFact[] = []): VNextTurnDelta => ({ add, patch: [], remove: [], relate: [], defer: [] });
const task = (title = 'カード'): VNextAddFact => ({ kind: 'task', localId: 'cards', category: 'study', title });
const work = (unitLabel = '枚'): VNextAddFact => ({ kind: 'workload', localId: 'quantity', taskRef: { localId: 'cards' },
  componentRef: null, quantityRole: 'remaining', amount: 10, unitCode: 'custom', unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const effort = (unitLabel = '枚'): VNextAddFact => ({ kind: 'effort_estimate', localId: 'pace', taskRef: { localId: 'cards' },
  targetRef: { localId: 'quantity' }, effortKind: 'duration_per_unit', minutes: 8, unitCode: 'custom', unitLabel, precision: 'exact' });
const input = (userText = 'カードは残り10枚で、1枚8分です。') => ({ userText, state: createEmptyWeeklyPlanningVNextState() });

describe('#951 provider label evidence before semantic acceptance', () => {
  it('rejects the captured translated title and both translated custom units without changing the input graph', () => {
    const request = input();
    const before = structuredClone(request.state);
    expect(validateVNextProviderLabelEvidence(request, { delta: delta([task('卡片'), work('张'), effort('张')]) })
      .map(error => error.localId)).toEqual(['cards', 'quantity', 'pace']);
    expect(request.state).toEqual(before);
  });

  it('accepts the Japanese control and preserves custom labels exactly', () => {
    expect(validateVNextProviderLabelEvidence(input(), { delta: delta([task(), work(), effort()]) })).toEqual([]);
    expect(validateVNextProviderLabelEvidence(input('カードは残り10セットで、1セット8分です。'),
      { delta: delta([task(), work('セット'), effort('セット')]) })).toEqual([]);
    expect(validateVNextProviderLabelEvidence(input(), { delta: delta([task(), work('個'), effort('個')]) })).toHaveLength(2);
  });

  it.each([
    ['研究室のレポートを仕上げたいです。', '研究室のレポートを仕上げる', '研究室のレポート'],
    ['10ページ終わりました。残り5ページを進めたいです。', 'ページ作業', 'ページ'],
  ])('preserves a legitimate paraphrase with a provider-selected name quotation: %s', (text, title, quote) => {
    expect(validateVNextProviderLabelEvidence(input(text), { delta: delta([task(title)]) }, [{ localId: 'cards', quote }])).toEqual([]);
    expect(validateVNextProviderLabelEvidence(input(text), { delta: delta([task(title)]) })).toHaveLength(1);
  });

  it.each(['', ' ', '不存在', 'カード'])('does not accept a foreign or unrelated quotation for translated 卡片: %s', quote => {
    expect(validateVNextProviderLabelEvidence(input(), { delta: delta([task('卡片')]) }, [{ localId: 'cards', quote }])).not.toEqual([]);
  });

  it('does not let duplicate or unbound quotation identities prove a task', () => {
    const reading = { delta: delta([task()]) };
    expect(validateVNextProviderLabelEvidence(input(), reading, [{ localId: 'missing', quote: 'カード' }])).not.toEqual([]);
    expect(validateVNextProviderLabelEvidence(input(), reading, [{ localId: 'cards', quote: '不存在' }])).not.toEqual([]);
    expect(validateVNextProviderLabelEvidence(input(), reading,
      [{ localId: 'cards', quote: 'カード' }, { localId: 'cards', quote: 'カード' }])).not.toEqual([]);
  });

  it('uses user context and adopted attachment wording, never renderer prose, as literal evidence', () => {
    const reading = { delta: delta([task(), work(), effort()]) };
    expect(validateVNextProviderLabelEvidence({ ...input('それを予定にして'), recentConversation:
      [{ role: 'user', content: 'カードは残り10枚です。' }] }, reading)).toEqual([]);
    expect(validateVNextProviderLabelEvidence({ ...input('添付の内容で作って'), supplementalContext: 'カード10枚、1枚8分' }, reading)).toEqual([]);
    expect(validateVNextProviderLabelEvidence({ ...input('それを予定にして'), recentConversation:
      [{ role: 'assistant', content: 'カードは残り10枚です。' }] }, reading)).toHaveLength(3);
  });

  it('accepts explicit foreign-language labels without a language detector or translation table', () => {
    expect(validateVNextProviderLabelEvidence(input('卡片は残り10张、1张8分です。'),
      { delta: delta([task('卡片'), work('张'), effort('张')]) })).toEqual([]);
  });

  it('retains the existing canonical percent representation for a percentage stated in words', () => {
    expect(validateVNextProviderLabelEvidence(input('カードは残り10パーセントで、1パーセント8分です。'),
      { delta: delta([task(), work('%'), effort('%')]) })).toEqual([]);
  });

  it('uses active accepted labels for a short contextual answer and validates label corrections', () => {
    const request = input();
    const seeded = applyWeeklyPlanningVNextTurn(request.state, delta([task(), work(), effort()]), {
      expectedRevision: 0, acceptedDate: '2026-11-07', weekStartsOn: 'monday',
      planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
      defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
      turnKey: 'seed', conversationId: 'labels', turnId: 'seed', sourceText: request.userText,
    });
    if (seeded.status !== 'applied') throw new Error(JSON.stringify(seeded));
    const next = { userText: 'はい、その内容です。', state: seeded.state };
    expect(validateVNextProviderLabelEvidence(next, { delta: delta([task(), work(), effort()]) })).toEqual([]);
    const corrected = delta();
    corrected.patch.push({ kind: 'workload', localId: 'fix', targetFactId: seeded.state.graph.workloads[0].id, amountDelta: null,
      changes: { amount: null, unitCode: null, unitLabel: '张', quantityRole: null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } });
    expect(validateVNextProviderLabelEvidence(next, { delta: corrected })).toMatchObject([{ localId: 'fix' }]);
    expect(validateVNextProviderLabelEvidence({ ...next, userText: '単位は张に変えてください。' }, { delta: corrected })).toEqual([]);
    corrected.patch = [{ kind: 'task', localId: 'rename', targetFactId: seeded.state.graph.tasks[0].id,
      changes: { category: null, title: '卡片' } }];
    expect(validateVNextProviderLabelEvidence(next, { delta: corrected })).toMatchObject([{ localId: 'rename' }]);
  });
});
