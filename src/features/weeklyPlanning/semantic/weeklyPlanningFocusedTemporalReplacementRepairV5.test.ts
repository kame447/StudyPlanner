import { describe, expect, it } from 'vitest';
import { applyFocusedTemporalReplacementRepairV5, parseFocusedTemporalReplacementRepairDecisionV5, type FocusedTemporalReplacementCandidateV5 } from './weeklyPlanningFocusedTemporalReplacementRepairV5';

const candidate = (taskIndex: number): FocusedTemporalReplacementCandidateV5 => ({
  localId: 'temporal_1', correctionIndex: 0, correctionQuote: '来週の金曜までに延ばす', taskIndex,
  task: { id: 'wpf_task_1', title: '教材A', category: 'study' },
  replaces: { kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-10-09' },
});
const base = (tasks: unknown[]) => JSON.stringify({ schemaVersion: 'v', corrections: [], tasks });
const USER = 'じゃあ来週の金曜までに延ばす';
const answer = (over: Record<string, unknown> = {}) => ({ replacements: [{ localId: 'temporal_1', decision: 'provided' as const, dateExpression: '2026-10-16', sourceText: '来週の金曜まで', ...over }] });

describe('focused temporal replacement merge', () => {
  it('adds the replacement under the existing-entity shell when the reading has no task entry, inheriting kind and level', () => {
    const merged = JSON.parse(applyFocusedTemporalReplacementRepairV5({ rawResponse: base([]), userText: USER, candidates: [candidate(-1)], decision: answer() })!);
    expect(merged.tasks).toHaveLength(1);
    expect(merged.tasks[0]).toMatchObject({ existingPublicId: 'wpf_task_1', temporalConstraints: [expect.objectContaining({
      localId: 'temporal_1', kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-10-16', targetLocalId: merged.tasks[0].localId })] });
  });
  it('adds it to the bound task entry otherwise', () => {
    const merged = JSON.parse(applyFocusedTemporalReplacementRepairV5({ rawResponse: base([{ localId: 't', existingPublicId: 'wpf_task_1', temporalConstraints: [] }]),
      userText: USER, candidates: [candidate(0)], decision: answer() })!);
    expect(merged.tasks[0].temporalConstraints[0]).toMatchObject({ localId: 'temporal_1', targetLocalId: 't' });
  });
  it.each([
    ['fallback', { decision: 'fallback' }],
    ['a quote that is not the user\'s words', { sourceText: '再来週の月曜' }],
    ['a non-canonical date expression', { dateExpression: '来週の金曜' }],
    ['an empty quote', { sourceText: ' ' }],
  ])('returns null (today\'s recovery) for %s', (_name, over) => {
    expect(applyFocusedTemporalReplacementRepairV5({ rawResponse: base([]), userText: USER, candidates: [candidate(-1)], decision: answer(over) })).toBeNull();
  });
  it('requires exactly one answer per dangling id', () => {
    expect(applyFocusedTemporalReplacementRepairV5({ rawResponse: base([]), userText: USER, candidates: [candidate(-1)], decision: { replacements: [] } })).toBeNull();
    expect(parseFocusedTemporalReplacementRepairDecisionV5('{"replacements":[],"extra":1}')).toBeNull();
  });
});
