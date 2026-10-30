import { describe, expect, it, vi } from 'vitest';
import { isCandidateChoiceDecisionContext } from '../../../../../shared/candidateChoiceDecision';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { CalibratedChoicePolicy, CandidateChoiceRequest } from '../../application/candidateSelection';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationInput,
} from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import {
  readWeeklyPlanningVNextExperimentalSession,
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextOptionChoiceInterpreter } from './weeklyPlanningVNextOptionChoice';
import { presentWeeklyPlanningVNextQuestion } from './weeklyPlanningVNextQuestionText';

const pages = (localId: string, role: 'scope_total' | 'completed' | 'remaining', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null, quantityRole: role, amount,
  unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
function stateWith(adds: VNextAddFact[]): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { add: [
    { kind: 'task', localId: 't', category: 'study', title: '数学プリント' }, ...adds,
  ], patch: [], remove: [], relate: [], defer: [] }, {
    acceptedDate: '2026-11-02', turnKey: 'seed', expectedRevision: 0, conversationId: 'c', turnId: 'seed', sourceText: 'seed',
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
function input(state: WeeklyPlanningVNextState, userText: string): WeeklyPlanningVNextInterpretationInput {
  const projection = projectWeeklyPlanningVNext(state);
  return { client: {} as OpenAiCompatibleClient, state, projection, presentedQuestion: projection.questions[0] ?? null, userText,
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } };
}
const fullReadingResult: WeeklyPlanningVNextInterpretation = { status: 'interpreted',
  delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
const policy = (optionCount: number): CalibratedChoicePolicy => ({ id: 'test', calibrationEvidenceId: 'synthetic-test-only',
  rules: [{ menuKind: 'leaves', optionCount, depth: 0, minimumTopProbability: 0.8, minimumMargin: 0.5 }] });
/** The client-shaped response the gate reads (the production client maps the Worker evaluation to this). */
const optionIdOf = (option: CandidateChoiceRequest['menu']['options'][number]) =>
  (option.kind === 'leaf' ? String(option.candidate.tuple.optionId) : option.id);
const menuId = (request: CandidateChoiceRequest, optionId: string) => request.menu.options.find((option) => optionIdOf(option) === optionId)!.id;
const response = (request: CandidateChoiceRequest, candidateId: string, sufficiency = 'only_candidate_meaning') => ({
  nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
  candidateSetHash: request.candidateSetHash, semanticSufficiency: sufficiency, optionId: menuId(request, candidateId),
  probabilities: request.menu.options.map((option) => ({ optionId: option.id,
    probability: option.id === menuId(request, candidateId) ? 0.9 : 0.1 / (request.menu.options.length - 1) })),
});

// Stated remaining 7 against total 20 − completed 12 = 8: remaining_inconsistent with two options.
const inconsistent = () => stateWith([pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7)]);

describe('VNext closed-set option choice before the full reading', () => {
  it('selects one of the presented options as an option answer, without the full reading', async () => {
    const state = inconsistent();
    const fullReading = vi.fn(async () => fullReadingResult);
    let menu: string[] = [];
    const choose = vi.fn(async (request: CandidateChoiceRequest, beforeDispatch: () => void) => {
      beforeDispatch();
      menu = request.menu.options.map(optionIdOf);
      return response(request, 'remaining_follows_progress');
    });
    const outcomes: unknown[] = [];
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, choice: { policy: policy(3), choose },
      scope: { ownerId: 'o', conversationId: 'c' }, onOutcome: (outcome) => outcomes.push(outcome) });
    const result = await interpret(input(state, '計算どおり8枚でいいです'));
    expect(new Set(menu)).toEqual(new Set(['none', 'remaining_follows_progress', 'completed_follows_remaining']));
    expect(outcomes).toEqual([{ route: 'option_choice', optionId: 'remaining_follows_progress' }]);
    expect(input(state, '').presentedQuestion?.code).toBe('remaining_inconsistent');
    expect(result).toMatchObject({ status: 'interpreted', answer: { kind: 'option', optionId: 'remaining_follows_progress' },
      delta: { add: [], patch: [], remove: [] }, metrics: { calls: 1 } });
    expect(fullReading).not.toHaveBeenCalled();
  });

  it.each([
    ['none', (request: CandidateChoiceRequest) => response(request, 'none')],
    ['extra_meaning', (request: CandidateChoiceRequest) => response(request, 'remaining_follows_progress', 'extra_or_uncertain_meaning')],
    ['provider_error', () => { throw new Error('timeout'); }],
  ])('sends the whole utterance to the full reading on %s', async (reason, reply) => {
    const state = inconsistent();
    const fullReading = vi.fn(async () => fullReadingResult);
    const outcomes: unknown[] = [];
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, scope: { ownerId: 'o', conversationId: 'c' },
      onOutcome: (outcome) => outcomes.push(outcome),
      choice: { policy: policy(3), choose: async (request, beforeDispatch) => { beforeDispatch(); return reply(request); } } });
    const utterance = '8枚でいいです。あと英語の音読も30分やりたい';
    const result = await interpret(input(state, utterance));
    expect(fullReading).toHaveBeenCalledWith(expect.objectContaining({ userText: utterance }));
    expect(result).toMatchObject({ answer: null, metrics: { calls: 2 } });
    expect(outcomes).toEqual([{ route: 'full_reading', reason }]);
  });

  it('sends a request the candidate wire accepts, whatever the length of the facts it is about', async () => {
    // Two remaining statements in different units, no single target: the menu is distinct / keep:<lineage> ×2.
    const long = 'c'.repeat(120);
    const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { add: [
      { kind: 'task', localId: 't', category: 'study', title: '数学' }, pages('a', 'remaining', 20),
      { ...pages('b', 'remaining', 8), unitCode: 'custom', unitLabel: '問' } as VNextAddFact,
    ], patch: [], remove: [], relate: [], defer: [] }, {
      acceptedDate: '2026-11-02', turnKey: `${long}:t1`, expectedRevision: 0, conversationId: long, turnId: 't1', sourceText: 'seed',
    });
    if (result.status !== 'applied') throw new Error(JSON.stringify(result));
    const sent: CandidateChoiceRequest[] = [];
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading: vi.fn(async () => fullReadingResult),
      scope: { ownerId: 'o', conversationId: long },
      choice: { policy: policy(4), choose: async (request, beforeDispatch) => {
        beforeDispatch();
        sent.push(request);
        return response(request, 'distinct');
      } } });
    const reply = await interpret(input(result.state, '別々です'));
    expect(input(result.state, '').presentedQuestion?.options.map(({ optionId }) => optionId.slice(0, 5))).toEqual(['disti', 'keep:', 'keep:']);
    expect(sent).toHaveLength(1);
    expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: sent[0] })).toBe(true);
    expect(reply).toMatchObject({ answer: { kind: 'option', optionId: 'distinct' } });
  });

  it('never dispatches for an uncalibrated menu or an open-value question', async () => {
    const choose = vi.fn();
    const fullReading = vi.fn(async () => fullReadingResult);
    const uncalibrated = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, choice: { policy: policy(5), choose },
      scope: { ownerId: 'o', conversationId: 'c' } });
    await uncalibrated(input(inconsistent(), '8枚で'));
    // missing_effort_estimate asks for an open value: always the full reading.
    const open = stateWith([pages('left', 'remaining', 8)]);
    expect(input(open, '').presentedQuestion?.code).toBe('missing_effort_estimate');
    await uncalibrated(input(open, '40分'));
    expect(choose).not.toHaveBeenCalled();
    expect(fullReading).toHaveBeenCalledTimes(2);
  });
});

// The session is the only caller: it decides which question was shown, and its checkpoint is the freshness authority.
describe('VNext option choice inside the experimental session', () => {
  const scope: WeeklyPlanningVNextExperimentalScope = {
    ownerId: 'o', weekStartDate: '2026-11-02', conversationId: 'c', weekStartsOn: 'monday', notBeforeTime: '09:00',
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' },
  };
  const seed = { ...fullReadingResult, delta: { ...fullReadingResult.delta, add: [
    { kind: 'task', localId: 't', category: 'study', title: '数学プリント' } as VNextAddFact,
    pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7)] } };
  const english = { ...fullReadingResult, delta: { ...fullReadingResult.delta, add: [
    { kind: 'task', localId: 'e', category: 'study', title: '英語' } as VNextAddFact,
    { ...pages('m', 'remaining', 30), taskRef: { localId: 'e' }, unitCode: 'minute', unitLabel: '分' } as VNextAddFact] } };
  /** One browser tab: its own interpreter, the shared checkpoint slots. */
  function tab(slots: Map<string, string>, interpret: WeeklyPlanningVNextExperimentalPorts['interpret']): WeeklyPlanningVNextExperimentalPorts {
    const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
    return { client: {} as OpenAiCompatibleClient, interpret, checkpoint: slot('vnext'), legacyV5Checkpoint: { read: () => null },
      approvalLedger: slot('ledger'), now: () => '2026-11-02T09:00:00.000Z',
      calendar: () => ({ plans: [], monthEvents: [], scheduleTemplates: [] }),
      renderer: { render: async () => ({ status: 'rendered' as const, text: '（説明）', rawResponse: '' }) },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async (block) => ({ planId: block.id }) } };
  }
  const say = (ports: WeeklyPlanningVNextExperimentalPorts, turnId: string, userText: string, shownRevision: number | null) =>
    submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId, userText, shownRevision });

  it('offers Jev the displayed text and labels, and applies a chosen option through the binder', async () => {
    const slots = new Map<string, string>();
    const shown = await say(tab(slots, async () => seed), 't1', '数学プリントは20枚、12枚終わって、残り7枚', null);
    const read = readWeeklyPlanningVNextExperimentalSession(scope, tab(slots, vi.fn()));
    if (read.status !== 'ready') throw new Error(read.status);
    // The reply prose comes from the renderer, which must include the option labels; Jev reads the
    // structured presentation of the same question (its text and those labels).
    const presentation = presentWeeklyPlanningVNextQuestion(read.checkpoint.state, shown.question!);
    expect(presentation.text).toContain('（残りを8枚にする / 終わった量を13枚にする）');
    const fullReading = vi.fn(async () => fullReadingResult);
    let offered: CandidateChoiceRequest | null = null;
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, scope: { ownerId: 'o', conversationId: 'c' },
      choice: { policy: policy(3), choose: async (request, beforeDispatch) => {
        beforeDispatch();
        offered = request;
        return response(request, 'remaining_follows_progress');
      } } });
    const answered = await say(tab(slots, interpret), 't2', '計算どおり8枚でいいです', shown.graphRevision);
    expect(offered!.context.presentedQuestion).toBe(presentation.text);
    expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: offered })).toBe(true);
    expect(new Set(offered!.menu.options.flatMap((option) => (option.kind === 'leaf' ? [option.candidate.label] : []))))
      .toEqual(new Set(['残りを8枚にする', '終わった量を13枚にする']));
    expect(fullReading).not.toHaveBeenCalled();
    expect(answered).toMatchObject({ outcome: 'applied', appliedDelta: { patch: [{ targetFactId: expect.any(String), changes: { amount: 8 } }] } });
    expect(answered.question?.code).not.toBe('remaining_inconsistent');
  });

  it('reads a reply to an older revision without its question: no Jev dispatch, and no answer binds', async () => {
    const slots = new Map<string, string>();
    const shown = await say(tab(slots, async () => seed), 't1', '数学プリントは20枚、12枚終わって、残り7枚', null);
    // Another tab moves the conversation on; the same question is shown again there at the new revision.
    const other = await say(tab(slots, async () => english), 'b1', '英語も30分', shown.graphRevision);
    expect(other.question?.key).toBe(shown.question?.key);
    const choose = vi.fn();
    const fullReading = vi.fn(async (input: WeeklyPlanningVNextInterpretationInput) => {
      expect(input.presentedQuestion).toBeNull();
      return { ...fullReadingResult, answer: { kind: 'option' as const, optionId: 'remaining_follows_progress' } };
    });
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, choice: { policy: policy(3), choose },
      scope: { ownerId: 'o', conversationId: 'c' } });
    const late = await say(tab(slots, interpret), 't2', '8枚でいいです', shown.graphRevision);
    expect(choose).not.toHaveBeenCalled();
    expect(late).toMatchObject({ outcome: 'answer_represented', graphRevision: other.graphRevision, appliedDelta: null });
  });

  it('writes nothing when another tab saves while Jev is choosing', async () => {
    const slots = new Map<string, string>();
    const shown = await say(tab(slots, async () => seed), 't1', '数学プリントは20枚、12枚終わって、残り7枚', null);
    let otherRaw: string | undefined;
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading: vi.fn(async () => fullReadingResult),
      scope: { ownerId: 'o', conversationId: 'c' },
      choice: { policy: policy(3), choose: async (request, beforeDispatch) => {
        beforeDispatch();
        await say(tab(slots, async () => english), 'b1', '英語も30分', shown.graphRevision);
        otherRaw = slots.get('vnext');
        return response(request, 'remaining_follows_progress');
      } } });
    const result = await say(tab(slots, interpret), 't2', '8枚でいいです', shown.graphRevision);
    expect(result).toMatchObject({ outcome: 'stale', appliedDelta: null });
    expect(slots.get('vnext')).toBe(otherRaw);
  });
});
