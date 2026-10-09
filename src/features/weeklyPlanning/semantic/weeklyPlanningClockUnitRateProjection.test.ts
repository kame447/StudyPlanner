import { describe, expect, it } from 'vitest';
import { projectWeeklyPlanningExistingWorkloadRateReferenceV5, CLOCK_UNIT_RATE_PROJECTED_PREFIX } from './weeklyPlanningExistingWorkloadRateReferenceV5';
import { rateUnitProjectedFromRepairsV5 } from './weeklyPlanningRateUnitProjectionFactV5';
import { ignoredRateForMissingEffortQuestionV5 } from './weeklyPlanningIgnoredRateDisclosureV5';
import { weeklyPlanningIgnoredRateText, weeklyPlanningRateNotices, weeklyPlanningRateUnitProjectedText } from '../dialogue/weeklyPlanningRateDisclosure';

type Json = Record<string, unknown>;
const workload = (localId: string, unitCode: string, unitLabel: string): Json => ({ localId, quantityRole: 'target', amount: 15, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '15' });
const estimate = (targetLocalId: string, unitCode: string, over: Json = {}): Json => ({ localId: 'rate', targetLocalId, kind: 'duration_per_unit', minutes: 6, unitCode,
  precision: 'approximate', sourceText: '1問6分', ...over });
const document = (task: Json) => JSON.stringify({ schemaVersion: 'x', planningIntent: 'create_plan', planningWindow: null, tasks: [{ localId: 'phys', existingPublicId: null,
  decompositionStatus: 'atomic', category: 'study', title: '物理', study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
  workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '物理', ...task }] });
const project = (task: Json) => { const raw = document(task); return { raw, ...projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse: raw }) }; };
const unitOfRate = (raw: string) => (JSON.parse(raw).tasks[0].effortEstimates[0] as Json).unitCode;

describe('clock-unit rate projection (x8)', () => {
  it.each(['minute', 'hour'])('takes the single non-clock workload\'s unit for a %s rate on a workload localId, with a diagnostic payload', clock => {
    const result = project({ workloads: [workload('amt', 'problem', '問')], effortEstimates: [estimate('amt', clock)] });
    expect(unitOfRate(result.raw === result.rawResponse ? result.raw : result.rawResponse)).toBe('problem');
    expect(result.repairs).toEqual([`${CLOCK_UNIT_RATE_PROJECTED_PREFIX}${JSON.stringify(['phys', 'rate', clock, 'problem', '1問6分', 6, '問'])}`]);
    expect(rateUnitProjectedFromRepairsV5(result.repairs)).toEqual({ quote: '1問6分', minutes: 6, unitLabel: '問' });
  });

  it('resolves a component localId and a task target with exactly one component workload', () => {
    const component = { localId: 'comp', existingPublicId: null, parentLocalId: null, role: 'material', label: '問題集', workloads: [workload('amt', 'problem', '問')], durableContextSignals: [], sourceText: '問題集' };
    for (const target of ['comp', 'phys', 'amt']) {
      const result = project({ study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [component] }, effortEstimates: [estimate(target, 'minute')] });
      expect(unitOfRate(result.rawResponse)).toBe('problem');
      expect(result.repairs).toHaveLength(1);
    }
  });

  it.each([
    ['several workloads under a task target (different units)', { workloads: [workload('a', 'problem', '問'), workload('b', 'page', 'ページ')], effortEstimates: [estimate('phys', 'minute')] }],
    ['several workloads under a task target (same unit)', { workloads: [workload('a', 'problem', '問'), workload('b', 'problem', '問')], effortEstimates: [estimate('phys', 'minute')] }],
    ['a clock-unit workload', { workloads: [workload('a', 'minute', '分')], effortEstimates: [estimate('a', 'minute')] }],
    ['a non-clock mismatch (page rate on a problem workload)', { workloads: [workload('a', 'problem', '問')], effortEstimates: [estimate('a', 'page')] }],
    ['an unknown target', { workloads: [workload('a', 'problem', '問')], effortEstimates: [estimate('nowhere', 'minute')] }],
    ['no quote to state', { workloads: [workload('a', 'problem', '問')], effortEstimates: [estimate('a', 'minute', { sourceText: '' })] }],
    ['a session_duration effort', { workloads: [workload('a', 'problem', '問')], effortEstimates: [estimate('a', 'minute', { kind: 'session_duration' })] }],
  ])('leaves %s untouched', (_name, task) => {
    const result = project(task);
    expect(result.rawResponse).toBe(result.raw);
    expect(result.repairs).toEqual([]);
  });
});

describe('rate facts and sentences (x8)', () => {
  it('states the projected rate and the unusable rate once each, from typed fields only', () => {
    expect(weeklyPlanningRateUnitProjectedText({ quote: '物理は1問6分くらい', minutes: 6, unitLabel: '問' })).toBe('「物理は1問6分くらい」は、問あたり6分として使いました。');
    expect(weeklyPlanningIgnoredRateText({ quote: '物理は1問6分くらい', unit: '問' })).toBe('「物理は1問6分くらい」は、この作業の単位（問）と合わなかったため使えませんでした。');
    expect(weeklyPlanningRateNotices(undefined)).toBe('');
    expect(weeklyPlanningRateNotices({ ignoredRate: { quote: 'Q', unit: '問' } }).split('合わなかったため').length).toBe(2);
  });
  it('the parser ignores other diagnostics and a malformed payload', () => {
    expect(rateUnitProjectedFromRepairsV5(['other:thing', `${CLOCK_UNIT_RATE_PROJECTED_PREFIX}not-json`])).toBeNull();
    expect(rateUnitProjectedFromRepairsV5(undefined)).toBeNull();
  });
  const fact = (over: Json = {}) => ({ id: 'w1', taskId: 't1', componentId: null, unitCode: 'problem', unitLabel: '問', ...over });
  const effort = (over: Json = {}) => ({ id: 'e1', taskId: 't1', targetFactId: 'w1', kind: 'duration_per_unit', unitCode: 'page', source: { sourceText: ' 1問6分 ' }, ...over });
  const view = (workloads: unknown[], efforts: unknown[]) => ({ workloads, effortEstimates: efforts }) as never;
  it('discloses only an accepted per-unit rate aimed at the workload whose unit differs', () => {
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort()]), workloadFactId: 'w1' })).toEqual({ quote: '1問6分', unit: '問' });
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort({ targetFactId: 't1' })]), workloadFactId: 'w1' })).toEqual({ quote: '1問6分', unit: '問' });
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort({ unitCode: 'problem' })]), workloadFactId: 'w1' })).toBeNull();
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort({ kind: 'total_duration' })]), workloadFactId: 'w1' })).toBeNull();
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort({ targetFactId: 'other', taskId: 'other-task' })]), workloadFactId: 'w1' })).toBeNull();
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort()]), workloadFactId: null })).toBeNull();
    expect(ignoredRateForMissingEffortQuestionV5({ view: view([fact()], [effort()]), workloadFactId: 'missing' })).toBeNull();
  });
});
