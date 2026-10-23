import { describe, expect, it } from 'vitest';
import { focusedContextualDecisionState, isFocusedContextualDecisionContext } from './focusedContextualDecision';
import { isFocusedContextualTargetBinding } from './focusedContextualTargetBinding';
import { createFocusedContextualBindingSnapshotV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualBindingV5';
import { createFocusedContextualBindingInputFixtureV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualBindingV5.testUtils';

function context() {
  return structuredClone(createFocusedContextualBindingSnapshotV5(createFocusedContextualBindingInputFixtureV5())!.context);
}
describe('J1 v2 envelope consistency and UTF-8 caps', () => {
  for (const [field, expected] of [
    ['questionCode', 'quantity_role_unresolved'], ['task.category', 'study'],
    ['component.role', 'material'], ['workload.quantityRole', 'declared'], ['workload.unitCode', 'problem'],
  ]) {
    it.each([[expected], { value: expected }, 1, true, null])(`rejects non-string ${field} %j`, invalid => {
      const target = context().state.pendingQuestion.target;
      const object = field === 'questionCode' ? target : field === 'task.category' ? target.task
        : field === 'component.role' ? target.componentChain[0] : target.workload;
      const keys = field.split('.');
      const key = keys[keys.length - 1];
      Object.assign(object, { [key]: invalid });
      expect(isFocusedContextualTargetBinding(target)).toBe(false);
    });
  }
  for (const field of ['targetToken', 'task.title', 'component.label', 'workload.unitLabel', 'workload.rangeStart', 'workload.rangeEnd', 'workload.periodExpression']) {
    it.each([['text'], { value: 'text' }, 1, true])(`rejects non-string label/range ${field} %j`, invalid => {
      const value = context(); const target = value.state.pendingQuestion.target;
      const object = field === 'targetToken' ? target : field.startsWith('task.') ? target.task
        : field.startsWith('component.') ? target.componentChain[0] : target.workload;
      Object.assign(object, { [field.split('.').slice(-1)[0]]: invalid });
      expect(isFocusedContextualTargetBinding(target)).toBe(false);
      expect(isFocusedContextualDecisionContext(value)).toBe(false);
      expect(focusedContextualDecisionState(value)).toBeNull();
    });
  }
  it('rejects null required labels and preserves nullable range/period controls', () => {
    for (const field of ['targetToken', 'task.title', 'component.label', 'workload.unitLabel']) {
      const target = context().state.pendingQuestion.target;
      const object = field === 'targetToken' ? target : field.startsWith('task.') ? target.task
        : field.startsWith('component.') ? target.componentChain[0] : target.workload;
      Object.assign(object, { [field.split('.').slice(-1)[0]]: null });
      expect(isFocusedContextualTargetBinding(target)).toBe(false);
    }
    expect(isFocusedContextualTargetBinding(context().state.pendingQuestion.target)).toBe(true);
  });
  it('validates and immutably snapshots the bound tuple', () => {
    const value = context();
    expect(isFocusedContextualDecisionContext(value)).toBe(true);
    const state = focusedContextualDecisionState(value)!;
    value.state.pendingQuestion.target.task.title = 'changed';
    expect(state.pendingQuestion).toMatchObject({ target: { task: { title: '数学' } } });
    expect(Object.isFrozen(state.pendingQuestion)).toBe(true);
  });
  it.each(['source revision', 'target token', 'question code', 'role', 'unknown top', 'unknown tuple'])(
    'rejects %s rather than dropping v2 fields', fault => {
      const value = context();
      if (fault === 'source revision') value.state.pendingQuestion.target.sourceRevision = 7;
      if (fault === 'target token') value.targetToken = 'other-slot';
      if (fault === 'question code') value.state.pendingQuestion.target.questionCode = 'missing_effort_estimate';
      if (fault === 'role') value.state.pendingQuestion.target.workload.quantityRole = 'remaining';
      if (fault === 'unknown top') Object.assign(value, { model: 'attacker' });
      if (fault === 'unknown tuple') Object.assign(value.state.pendingQuestion.target, { graph: {} });
      expect(isFocusedContextualDecisionContext(value)).toBe(false);
      expect(focusedContextualDecisionState(value)).toBeNull();
    },
  );
  it.each([NaN, Infinity, -1, 0, Number.MAX_SAFE_INTEGER + 1])('rejects amount %s', amount => {
    const target = context().state.pendingQuestion.target; target.workload.amount = amount;
    expect(isFocusedContextualTargetBinding(target)).toBe(false);
  });
  it('supports exact multibyte byte boundaries without truncating qualifiers', () => {
    const target = context().state.pendingQuestion.target;
    target.task.title = 'あ'.repeat(170) + 'ab';
    expect(isFocusedContextualTargetBinding(target)).toBe(true);
    target.task.title += 'c';
    expect(isFocusedContextualTargetBinding(target)).toBe(false);
  });
  it('enforces total encoded tuple bytes independently of label caps', () => {
    const target = context().state.pendingQuestion.target;
    target.task.title = '\\'.repeat(512);
    target.componentChain = Array.from({ length: 8 }, () => ({ role: 'custom', label: '\\'.repeat(512) }));
    expect(isFocusedContextualTargetBinding(target)).toBe(false);
  });
  it.each(['depth', 'unit label', 'range bound', 'period', 'inverted numeric', 'partial range', 'missing period'])(
    'rejects %s', fault => {
      const target = context().state.pendingQuestion.target;
      if (fault === 'depth') target.componentChain = Array.from({ length: 9 }, () => ({ role: 'custom', label: 'valid' }));
      if (fault === 'unit label') target.workload.unitLabel = 'あ'.repeat(43);
      if (fault === 'range bound') { target.workload.rangeStart = 'a'.repeat(129); target.workload.rangeEnd = 'z'; }
      if (fault === 'period') target.workload.periodExpression = 'あ'.repeat(171);
      if (fault === 'inverted numeric') { target.workload.rangeStart = '40'; target.workload.rangeEnd = '21'; }
      if (fault === 'partial range') target.workload.rangeStart = '21';
      if (fault === 'missing period') target.workload.perOccurrence = true;
      expect(isFocusedContextualTargetBinding(target)).toBe(false);
    },
  );
  it('preserves opaque range bounds verbatim', () => {
    const target = context().state.pendingQuestion.target;
    target.workload.rangeStart = 'A'; target.workload.rangeEnd = 'K';
    expect(isFocusedContextualTargetBinding(target)).toBe(true);
    expect(target.workload.rangeStart).toBe('A');
  });
});
