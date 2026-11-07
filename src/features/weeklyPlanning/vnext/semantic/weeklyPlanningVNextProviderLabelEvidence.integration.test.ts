import { describe, expect, it, vi } from 'vitest';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from '../application/weeklyPlanningVNextExperimentalSession';
import { approveWeeklyPlanningVNextExperimentalPreview } from '../application/weeklyPlanningVNextExperimentalApproval';
import { createWeeklyPlanningVNextProviderInterpreter } from './weeklyPlanningVNextProvider';
import { VNEXT_LABEL_REPAIR_RESPONSE_FORMAT, VNEXT_PROVIDER_RESPONSE_FORMAT } from './weeklyPlanningVNextProviderSchema';

const wire = (title = 'カード', unit = '枚') => ({ planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { add: [
  { kind: 'task', localId: 'cards', category: 'study', title },
  { kind: 'workload', localId: 'left', taskRef: { localId: 'cards' }, componentRef: null,
    quantityRole: 'remaining', amount: 10, unitCode: 'custom', unitLabel: unit,
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'cards' }, targetRef: { localId: 'left' },
    effortKind: 'duration_per_unit', minutes: 8, unitCode: 'custom', unitLabel: unit, precision: 'exact' },
], patch: [], remove: [], relate: [], defer: [] } });

function harness(responses: unknown[]) {
  const slots = new Map<string, string>();
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const saved = new Set<string>();
  const savedTitles: string[] = [];
  const client = { createChatCompletion: vi.fn(async () => {
    if (!responses.length) throw new Error('Unexpected extra semantic call');
    return JSON.stringify(responses.shift());
  }) };
  const scope = { ownerId: 'synthetic-951', weekStartDate: '2026-11-02', conversationId: 'labels',
    notBeforeTime: '09:00', clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
      planningEndDate: '2026-11-08', weekStartsOn: 'monday' as const, timeZone: 'Asia/Tokyo' } };
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client, interpret: createWeeklyPlanningVNextProviderInterpreter(), checkpoint: slot('checkpoint'),
    legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('ledger'),
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    plans: { findExistingPlanId: async id => saved.has(id) ? `plan:${id}` : undefined,
      saveBlock: async block => { saved.add(block.id); savedTitles.push(block.title); return { planId: `plan:${block.id}` }; } },
    now: () => '2026-11-02T00:00:00.000Z',
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '確認用の説明です。', rawResponse: '' }) }),
  };
  return { client, slots, savedTitles, scope, ports,
    submit: (userText = 'カードは残り10枚で、1枚8分です。この内容で今週の計画を作ってください。') =>
      submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'read', userText, shownRevision: null }),
    approve: () => approveWeeklyPlanningVNextExperimentalPreview({ scope, ports }) };
}

describe('#951 label spelling across native reading, preview and save', () => {
  it.each([{ title: '卡片', unit: '张' }, { title: '卡片', unit: '枚' }, { title: 'カード', unit: '张' }])(
    'repairs captured $title/$unit once before preview and preserves the correct titles through idempotent approval', async ({ title, unit }) => {
      const h = harness([wire(title, unit), { ...wire(), labelEvidence: [] }]);
      const turn = await h.submit();
      expect(turn.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
      expect(turn.preview?.blocks.map(block => block.title)).toEqual(['カード 10枚']);
      expect(h.savedTitles).toEqual([]);
      const calls = h.client.createChatCompletion.mock.calls as unknown as [{ responseFormat: unknown }][];
      expect(calls[0][0].responseFormat).toEqual(VNEXT_PROVIDER_RESPONSE_FORMAT);
      expect(JSON.stringify(calls[0][0].responseFormat)).not.toContain('labelEvidence');
      expect(calls[1][0].responseFormat).toEqual(VNEXT_LABEL_REPAIR_RESPONSE_FORMAT);
      expect(turn.interpretation).not.toHaveProperty('labelEvidence');
      expect(h.slots.get('checkpoint')).not.toContain('labelEvidence');
      expect(await h.approve()).toMatchObject({ status: 'executed' });
      await h.approve();
      expect(h.savedTitles).toEqual(['カード 10枚']);
      expect(h.client.createChatCompletion).toHaveBeenCalledTimes(2);
    });

  it('leaves the normal first request and single-call path unchanged', async () => {
    const h = harness([wire()]);
    const turn = await h.submit();
    expect(turn.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
    expect(turn.preview?.blocks.map(block => block.title)).toEqual(['カード 10枚']);
    expect(h.client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it.each([{ labelEvidence: [] }, { labelEvidence: [{ localId: 'cards', quote: 'カード' }] }])('rejects a still-translated repair without a third call or saved state: $labelEvidence', async ({ labelEvidence }) => {
    const h = harness([wire('卡片', '张'), { ...wire('卡片', '张'), labelEvidence }]);
    const turn = await h.submit();
    expect(turn.interpretation).toMatchObject({ status: 'failed', reason: 'rejected_after_repair', metrics: { calls: 2, repairs: 1 } });
    expect(turn.preview?.blocks ?? []).toEqual([]);
    await h.approve();
    expect(h.savedTitles).toEqual([]);
    expect(h.slots.get('checkpoint') ?? '').not.toContain('卡片');
    expect(h.client.createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['研究室のレポートを仕上げたいです。残り10枚、1枚8分で予定を作って。', '研究室のレポートを仕上げる', '研究室のレポート'],
    ['10ページ終わりました。残り10枚、1枚8分のページ作業を予定にしたいです。', 'ページを進める作業', 'ページ'],
  ])('keeps a legitimate paraphrase using the one existing repair: %s', async (text, title, quote) => {
    const h = harness([wire(title), { ...wire(title), labelEvidence: [{ localId: 'cards', quote }] }]);
    const turn = await h.submit(text);
    expect(turn.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    expect(turn.preview?.blocks.map(block => block.title)).toEqual([`${title} 10枚`]);
    expect(h.slots.get('checkpoint')).not.toContain('labelEvidence');
    expect(h.client.createChatCompletion).toHaveBeenCalledTimes(2);
  });
});
