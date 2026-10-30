import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  VNEXT_JEV_COMPARISON_CASES,
  VNEXT_JEV_COMPARISON_DEV_CASES,
  VNEXT_JEV_COMPARISON_DEV_CASES_SHA256,
  VNEXT_JEV_COMPARISON_SPLIT_SHA256,
  type VNextJevComparisonCase,
} from './vnextJevComparisonCases';
import { projectWeeklyPlanningVNext } from '../vnext/projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../vnext/semantic/weeklyPlanningVNextTransaction';
import type { WeeklyPlanningVNextState } from '../vnext/weeklyPlanningVNextTypes';

function seedState(testCase: VNextJevComparisonCase): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), {
    add: [{ kind: 'task', localId: 'task', category: 'study', title: testCase.seed.taskTitle }, ...testCase.seed.facts],
    patch: [], remove: [], relate: [], defer: [],
  }, { acceptedDate: testCase.seed.acceptedDate, weekStartsOn: 'monday',
    planningHorizon: { startDate: testCase.seed.acceptedDate, endDate: '2026-11-08' },
    turnKey: `${testCase.id}:seed`, expectedRevision: 0,
    conversationId: `jev-case:${testCase.id}`, turnId: `${testCase.id}:seed`, sourceText: 'synthetic seeded state' });
  if (result.status !== 'applied') throw new Error(`Invalid seed ${testCase.id}: ${JSON.stringify(result)}`);
  return result.state;
}

function activeWork(state: WeeklyPlanningVNextState) {
  const activeIds = new Set(state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const titleByTaskId = new Map(state.graph.tasks.map((task) => [task.id, task.title]));
  return state.graph.workloads.filter((fact) => activeIds.has(fact.id)).map((fact) => ({
    taskTitle: titleByTaskId.get(fact.taskId)!, quantityRole: fact.quantityRole, amount: fact.amount,
    unitCode: fact.unitCode, unitLabel: fact.unitLabel,
  })).sort((a, b) => `${a.taskTitle}:${a.quantityRole}:${a.unitCode}:${a.amount}`.localeCompare(
    `${b.taskTitle}:${b.quantityRole}:${b.unitCode}:${b.amount}`));
}

function resolveChoice(testCase: VNextJevComparisonCase, state: WeeklyPlanningVNextState,
  question: NonNullable<ReturnType<typeof projectWeeklyPlanningVNext>['questions'][number]>) {
  if (typeof testCase.expectedChoice === 'string') {
    return question.options.find((option) => option.optionId === testCase.expectedChoice);
  }
  if (!testCase.expectedChoice || !('keep' in testCase.expectedChoice)) return undefined;
  const kept = testCase.expectedChoice.keep;
  const activeIds = new Set(state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  return question.options.find((option) => {
    if (!option.optionId.startsWith('keep:')) return false;
    const removedId = option.delta.remove[0]?.targetFactId;
    const retained = state.graph.workloads.filter((fact) => activeIds.has(fact.id) && fact.id !== removedId);
    return retained.length === 1 && retained[0].quantityRole === kept.quantityRole
      && retained[0].amount === kept.amount && retained[0].unitCode === kept.unitCode
      && retained[0].unitLabel === kept.unitLabel;
  });
}

function appliedChoiceState(testCase: VNextJevComparisonCase, state: WeeklyPlanningVNextState): WeeklyPlanningVNextState {
  const projection = projectWeeklyPlanningVNext(state);
  const question = projection.questions[0];
  if (!question) throw new Error(`No question for ${testCase.id}`);
  const option = resolveChoice(testCase, state, question);
  if (!option) throw new Error(`Expected menu choice missing for ${testCase.id}`);
  const result = applyWeeklyPlanningVNextTurn(state, option.delta, {
    acceptedDate: testCase.seed.acceptedDate, weekStartsOn: 'monday',
    planningHorizon: { startDate: testCase.seed.acceptedDate, endDate: '2026-11-08' },
    turnKey: `${testCase.id}:choice`, expectedRevision: state.graph.revision,
    conversationId: `jev-case:${testCase.id}`, turnId: `${testCase.id}:choice`, sourceText: testCase.userText,
  });
  if (result.status !== 'applied') throw new Error(`Option delta rejected for ${testCase.id}: ${JSON.stringify(result)}`);
  return result.state;
}

describe('VNext Jev → Luna comparison corpus', () => {
  it('keeps a fixed, disjoint development and holdout manifest', () => {
    const ids = VNEXT_JEV_COMPARISON_CASES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const manifest = VNEXT_JEV_COMPARISON_CASES.map(({ id, split, userText }) => `${id}\t${split}\t${userText}`).join('\n') + '\n';
    expect(createHash('sha256').update(manifest, 'utf8').digest('hex')).toBe(VNEXT_JEV_COMPARISON_SPLIT_SHA256);
    const devManifest = VNEXT_JEV_COMPARISON_DEV_CASES.map(({ id, split, userText }) => `${id}\t${split}\t${userText}`).join('\n') + '\n';
    expect(createHash('sha256').update(devManifest, 'utf8').digest('hex')).toBe(VNEXT_JEV_COMPARISON_DEV_CASES_SHA256);
    for (const split of ['dev', 'holdout'] as const) {
      expect(VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.split === split)).toHaveLength(16);
    }
    expect(VNEXT_JEV_COMPARISON_DEV_CASES).toHaveLength(16);
    expect(VNEXT_JEV_COMPARISON_DEV_CASES.every((entry) => entry.split === 'dev')).toBe(true);
    expect(VNEXT_JEV_COMPARISON_CASES).toHaveLength(32);
    expect(VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.expectedRoute === 'option_choice')).toHaveLength(14);
    expect(VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.expectedRoute === 'full_reading')).toHaveLength(18);
    const devTexts = new Set(VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.split === 'dev').map((entry) => entry.userText));
    const holdoutTexts = VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.split === 'holdout').map((entry) => entry.userText);
    expect(new Set(holdoutTexts).size).toBe(holdoutTexts.length);
    expect(holdoutTexts.some((text) => devTexts.has(text))).toBe(false);
  });

  it('seeds the declared menu and applies every allowed selection to its independent final-state oracle', () => {
    const cases = VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.expectedRoute === 'option_choice');
    for (const testCase of cases) {
      const initial = seedState(testCase);
      const initialProjection = projectWeeklyPlanningVNext(initial);
      const question = initialProjection.questions[0];
      expect(initialProjection.questions.map((item) => item.code), testCase.id).toEqual([
        testCase.menuShape === 'remaining_conflict' ? 'remaining_inconsistent' : 'same_or_distinct_work',
      ]);
      if (testCase.menuShape === 'remaining_conflict') {
        expect(question.options.map((option) => option.optionId)).toEqual(['remaining_follows_progress', 'completed_follows_remaining']);
      } else if (testCase.menuShape === 'one_target_same_or_distinct') {
        expect(question.options.map((option) => option.optionId)).toEqual(['distinct', 'same']);
      } else {
        expect(question.options[0].optionId).toBe('distinct');
        expect(question.options.slice(1).every((option) => option.optionId.startsWith('keep:'))).toBe(true);
      }
      if (testCase.menuShape === 'two_work_keep_or_distinct') {
        expect(question.options).toHaveLength(3);
        expect(question.options.filter((option) => option.optionId.startsWith('keep:')).map((option) => option.value).sort((a, b) => a - b))
          .toEqual([10, 45]);
      }

      const finalState = appliedChoiceState(testCase, initial);
      const finalProjection = projectWeeklyPlanningVNext(finalState);
      expect(activeWork(finalState), testCase.id).toEqual(testCase.finalState.activeWork.slice().sort((a, b) =>
        `${a.taskTitle}:${a.quantityRole}:${a.unitCode}:${a.amount}`.localeCompare(
          `${b.taskTitle}:${b.quantityRole}:${b.unitCode}:${b.amount}`)));
      const openCodes = finalProjection.questions.map((item) => item.code).sort();
      const deferredCodes = finalProjection.deferredQuestions.map((item) => item.code).sort();
      const questionStates = testCase.finalState.questionStateAlternatives ?? [{
        openQuestionCodes: testCase.finalState.openQuestionCodes,
        deferredQuestionCodes: testCase.finalState.deferredQuestionCodes,
      }];
      expect(questionStates.some((candidate) => JSON.stringify(openCodes) === JSON.stringify(candidate.openQuestionCodes.slice().sort())
        && JSON.stringify(deferredCodes) === JSON.stringify(candidate.deferredQuestionCodes.slice().sort())), testCase.id).toBe(true);
      expect(finalProjection.owners.flatMap((owner) => owner.work.map((work) => work.minutes)).sort((a, b) => (a ?? 0) - (b ?? 0)), testCase.id)
        .toEqual(testCase.finalState.scheduledWorkMinutes.slice().sort((a, b) => a - b));
      expect(finalState.graph.temporalConstraints.filter((fact) => finalState.graph.factLifecycles
        .some((entry) => entry.factId === fact.id && entry.status === 'active'))).toHaveLength(testCase.finalState.hardDeadlines.length);
      expect(testCase.finalState.hardDeadlines.every((fact) => fact.constraintKind === 'deadline'), testCase.id).toBe(true);
      expect(finalState.workRelations.map((relation) => relation.kind).sort(), testCase.id)
        .toEqual(testCase.finalState.relations.map((relation) => relation.kind).sort());
    }
  });

  it('records full-reading cases as explicit refusal, ambiguity, open-value, or mixed-meaning routes', () => {
    const allowedKinds = ['unsupported-value', 'refusal', 'new-topic', 'unknown-defer', 'approval-request',
      'mixed-deadline', 'mixed-task', 'mixed-correction', 'ambiguous'];
    for (const testCase of VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.expectedRoute === 'full_reading')) {
      expect(allowedKinds.some((kind) => testCase.id.endsWith(kind)), testCase.id).toBe(true);
      expect(testCase.expectedChoice, testCase.id).toBeNull();
      expect(testCase.finalState.savedPlanCount, testCase.id).toBe(0);
      expect(testCase.purpose.length, testCase.id).toBeGreaterThan(10);
      expect(testCase.reachablePath.length, testCase.id).toBeGreaterThan(10);
      expect(testCase.responsibility).toBe('Luna_full_semantic_reading');
      const seededQuestion = projectWeeklyPlanningVNext(seedState(testCase)).questions[0];
      expect(seededQuestion?.code).toBe(testCase.menuShape === 'remaining_conflict'
        ? 'remaining_inconsistent' : 'same_or_distinct_work');
    }
    expect(VNEXT_JEV_COMPARISON_CASES.find((entry) => entry.id === 'h-mixed-deadline')?.finalState.hardDeadlines)
      .toEqual([{ taskTitle: '数学プリント', date: '2026-11-03', constraintKind: 'deadline' }]);
  });

  it('documents every oracle correction in one line without changing the frozen utterances', () => {
    const corrected = VNEXT_JEV_COMPARISON_CASES.filter((entry) => entry.oracleCorrectionReason !== undefined);
    expect(corrected.length).toBeGreaterThan(0);
    for (const testCase of corrected) {
      expect(testCase.oracleCorrectionReason, testCase.id).toMatch(/^[^\r\n]+$/);
    }
    for (const id of ['d-unsupported-value', 'h-unsupported-value', 'd-refusal', 'h-refusal',
      'd-new-topic', 'h-new-topic', 'd-mixed-task', 'h-mixed-task', 'h-mixed-correction', 'h-ambiguous']) {
      expect(corrected.find((entry) => entry.id === id)?.oracleCorrectionReason, id).toBeTruthy();
    }
    const devNewTopic = VNEXT_JEV_COMPARISON_CASES.find((entry) => entry.id === 'd-new-topic')!;
    expect(devNewTopic.finalState.activeWork[devNewTopic.finalState.activeWork.length - 1])
      .toMatchObject({ quantityRole: 'target', amount: 25 });
    expect(devNewTopic.finalState.deferredQuestionCodes).toContain('remaining_inconsistent');
    const devMixedTask = VNEXT_JEV_COMPARISON_CASES.find((entry) => entry.id === 'd-mixed-task')!;
    expect(devMixedTask.finalState.activeWork.find((work) => work.amount === 15)).toMatchObject({
      taskTitle: '国語', quantityRole: 'target',
    });
    expect(VNEXT_JEV_COMPARISON_CASES.find((entry) => entry.id === 'h-ambiguous')?.finalState.relations)
      .toEqual([{ kind: 'distinct', leftTaskTitle: '英語 / pages', rightTaskTitle: '英語 / minutes' }]);
    expect(VNEXT_JEV_COMPARISON_CASES.find((entry) => entry.id === 'h-refusal')?.finalState.questionStateAlternatives)
      .toHaveLength(2);
  });
});
