import { describe, expect, it } from 'vitest';
import { measureWeeklyPlanningSemanticEvidenceCoverageV5 } from './weeklyPlanningSemanticEvidenceCoverageV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

// X3-T3 (Issue #488 round 4b): a numeric leaf quote earns coverage only for digit runs its typed fact accounts for.
const USER_TEXT = 'じゃあ3章ぶん、1章40分で見ておく';

function document(task: Record<string, unknown>): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
    tasks: [{ localId: 't', existingPublicId: 'task-1', category: 'study', title: 'x', study: null, workloads: [], effortEstimates: [],
      temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: USER_TEXT, ...task }],
  } as unknown as WeeklyPlanningSemanticDocumentV5;
}
const workload = (sourceText: string) => ({ localId: 'w', quantityRole: 'target', amount: 3, unitCode: 'chapter', unitLabel: '章',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const effort = (kind: string, minutes: number, sourceText: string) => ({ localId: 'e', targetLocalId: 'w', kind, minutes,
  unitCode: null, precision: 'approximate', sourceText });
const measure = (userText: string, doc: WeeklyPlanningSemanticDocumentV5, bounded = true) =>
  measureWeeklyPlanningSemanticEvidenceCoverageV5({ userText, document: doc, ...(bounded ? { boundedNumericSourceTexts: true } : {}) });

describe('literal coverage: digit runs a typed fact does not account for', () => {
  it('a workload quote that also states an unrepresented rate earns no coverage and the gap stays eligible', () => {
    const result = measure(USER_TEXT, document({ workloads: [workload('3章ぶん、1章40分')] }));
    expect(result).toMatchObject({ eligible: true, coveredCodePoints: 0, excludedNumericSourceCount: 1 });
  });

  it('control: when every digit run maps to a typed value the quotes stay covered (no extra call)', () => {
    const result = measure(USER_TEXT, document({
      workloads: [workload('3章ぶん')], effortEstimates: [effort('duration_per_unit', 40, '1章40分')],
    }));
    expect(result).toMatchObject({ eligible: false, excludedNumericSourceCount: 0 });
  });

  it('cost, not harm: a workload quote with a digit run its amount cannot account for (第3章を20ページ) audits', () => {
    const text = 'じゃあ第3章を20ページで見ておく';
    const doc = document({ workloads: [{ ...workload('第3章を20ページ'), amount: 20, unitCode: 'page', unitLabel: 'ページ' }], sourceText: text });
    expect(measure(text, doc)).toMatchObject({ eligible: true, excludedNumericSourceCount: 1 });
  });

  it('effort and recurrence quotes keep the old bound: unit digits (1回1時間, 1時間30分) cost nothing extra', () => {
    const text = 'じゃあ1回1時間で見ておく';
    const doc = document({ effortEstimates: [effort('session_duration', 60, '1回1時間')], sourceText: text });
    expect(measure(text, doc)).toMatchObject({ excludedNumericSourceCount: 0 });
  });

  it('the rule is scoped to the accepted-task-modification route (flag absent: unchanged)', () => {
    const result = measure(USER_TEXT, document({ workloads: [workload('3章ぶん、1章40分')] }), false);
    expect(result).toMatchObject({ coveredCodePoints: 10, eligible: false });
    expect(result).not.toHaveProperty('excludedNumericSourceCount');
  });

  it('a ranged workload accounts for its range bounds', () => {
    const text = 'じゃあ10から20ページで見ておく';
    const doc = document({ workloads: [{ ...workload('10から20ページ'), rangeStart: 10, rangeEnd: 20, amount: 11 }], sourceText: text });
    expect(measure(text, doc)).toMatchObject({ excludedNumericSourceCount: 0 });
  });
});
