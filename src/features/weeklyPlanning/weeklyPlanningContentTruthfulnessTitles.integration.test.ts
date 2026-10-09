import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './semantic/weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './semantic/weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5 } from './semantic/weeklyPlanningSchedulerWorkDistributionV5';
import {
  titleWithQuantityV5,
  workloadQuantityPhraseV5,
  workloadUnitDisplayV5,
} from './semantic/weeklyPlanningWorkloadQuantityLabelV5';

type Unit = 'minute' | 'hour' | 'problem' | 'page' | 'word' | 'custom';

function graphFor(params: {
  amount: number;
  unitCode: Unit;
  unitLabel: string;
  effort: { kind: 'duration_per_unit' | 'session_duration' | 'total_duration'; minutes: number };
  rangeStart?: string;
  rangeEnd?: string;
}): WeeklyPlanningFactGraph {
  const source = {
    conversationId: 'c', turnId: 't', semanticLocalId: 'w', sourceText: '数学', origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraph(),
    revision: 1,
    tasks: [{ id: 'task-math', category: 'study', title: '数学', source, createdRevision: 1 }],
    workloads: [{
      id: 'workload-math', taskId: 'task-math', componentId: null, quantityRole: 'target',
      amount: params.amount, unitCode: params.unitCode, unitLabel: params.unitLabel,
      rangeStart: params.rangeStart ?? null, rangeEnd: params.rangeEnd ?? null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'estimate-math', taskId: 'task-math', targetFactId: 'workload-math',
      kind: params.effort.kind, minutes: params.effort.minutes,
      unitCode: params.effort.kind === 'duration_per_unit' ? params.unitCode : null,
      precision: 'approximate', source, createdRevision: 1,
    }],
  } as WeeklyPlanningFactGraph;
}

function titles(graph: WeeklyPlanningFactGraph): { base: string[]; distributed: string[] } {
  const compiled = compileGenericPlanningWorkItems(graph);
  const distributed = distributeGenericSchedulerWorkItemsV5({
    graph, items: compiled.items, startDate: '2026-08-17', endDate: '2026-08-23',
  });
  return { base: compiled.items.map((item) => item.label), distributed: distributed.map((item) => item.label) };
}

describe('work-item titles state the computed amount with a trustworthy unit (live E 903時間)', () => {
  it('names a minute workload from the code even when the model kept 「3時間」', () => {
    const { base, distributed } = titles(graphFor({
      amount: 180, unitCode: 'minute', unitLabel: '3時間', effort: { kind: 'total_duration', minutes: 180 },
    }));
    expect(base).toEqual(['数学 180分']);
    expect(distributed.length).toBeGreaterThan(0);
    distributed.forEach((label) => expect(label).toMatch(/^数学 \d+分（/));
    expect(distributed.join('')).not.toMatch(/時間/);
  });

  it('does not echo the amount into a count unit (「220語」 / 「20問」)', () => {
    const { base, distributed } = titles(graphFor({
      amount: 20, unitCode: 'problem', unitLabel: '20問', effort: { kind: 'duration_per_unit', minutes: 20 },
    }));
    expect(base).toEqual(['数学 20問']);
    expect(distributed.length).toBeGreaterThan(1);
    distributed.forEach((label) => expect(label).toMatch(/^数学 \d問（\d{1,2}〜\d{1,2}問）$/));
  });

  it('keeps an explicit page range with the canonical unit and omits the phrase for a digit-bearing custom unit', () => {
    const pages = titles(graphFor({
      amount: 40, unitCode: 'page', unitLabel: '40ページ', effort: { kind: 'duration_per_unit', minutes: 4 },
      rangeStart: '21', rangeEnd: '60',
    }));
    expect(pages.distributed[0]).toMatch(/^数学 \d+ページ（21〜\d+ページ）$/);
    const custom = titles(graphFor({
      amount: 3, unitCode: 'custom', unitLabel: '3周', effort: { kind: 'duration_per_unit', minutes: 30 },
    }));
    expect(custom.base).toEqual(['数学']);
    custom.distributed.forEach((label) => expect(label).not.toMatch(/\d周|周/));
  });

  it('leaves a clean label byte-identical', () => {
    const { base, distributed } = titles(graphFor({
      amount: 40, unitCode: 'problem', unitLabel: '問', effort: { kind: 'duration_per_unit', minutes: 8 },
    }));
    expect(base).toEqual(['数学 40問']);
    expect(distributed[0]).toBe('数学 7問（1〜7問）');
  });
});

describe('workload unit display helper', () => {
  it('derives clock units from the code, keeps clean wording, falls back per code on a digit echo', () => {
    expect(workloadUnitDisplayV5('minute', 'x')).toBe('分');
    expect(workloadUnitDisplayV5('hour', '3時間')).toBe('時間');
    expect(workloadUnitDisplayV5('page', 'ページ')).toBe('ページ');
    expect(workloadUnitDisplayV5('page', 'p.')).toBe('p.');
    expect(workloadUnitDisplayV5('word', '220語')).toBe('語');
    expect(workloadUnitDisplayV5('word', '２２０語')).toBe('語');
    expect(workloadUnitDisplayV5('custom', '3周')).toBeNull();
    expect(workloadUnitDisplayV5('custom', '周')).toBe('周');
    expect(workloadQuantityPhraseV5(32, 'word', '220語')).toBe('32語');
    expect(workloadQuantityPhraseV5(3, 'custom', '3周')).toBe('');
    expect(titleWithQuantityV5('英単語', '')).toBe('英単語');
  });

  // The shared fix has no architecture switch, so legacy titles change in exactly two cases:
  // a clock unit labelled other than 分/時間, and a digit-bearing label. Everything else is identical.
  it('lists exactly which titles change (legacy included): clean labels are unchanged', () => {
    const clean: Array<['minute' | 'hour' | 'problem' | 'page' | 'word', string]> = [
      ['minute', '分'], ['hour', '時間'], ['problem', '問'], ['page', 'ページ'], ['word', '語'], ['problem', '題'],
    ];
    clean.forEach(([code, label]) => expect(workloadUnitDisplayV5(code, label)).toBe(label));
    expect(workloadUnitDisplayV5('minute', 'min')).not.toBe('min');
    expect(workloadUnitDisplayV5('problem', '20問')).not.toBe('20問');
  });
});
