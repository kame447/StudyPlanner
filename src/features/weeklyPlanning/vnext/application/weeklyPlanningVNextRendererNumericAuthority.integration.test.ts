import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';
import { submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'numeric-authority-owner', conversationId: 'numeric-authority', weekStartDate: '2026-11-02',
  notBeforeTime: '09:00', clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', weekStartsOn: 'monday', timeZone: 'Asia/Tokyo' },
};
const empty = () => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const reply = '残り10枚は約96分という計算になります。その時間でよいですか？';
const fallback = { decision: 'fallback', effortTarget: null, effortMeasurement: null,
  minutes: null, precision: null, quantityRole: null };
const perUnit = { decision: 'effort_answer', hasAdditionalRequest: false, effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
  minutes: 8, precision: 'exact', quantityRole: null };
const initialReading = {
  planningIntent: 'create_plan', conversationActs: [], answer: null,
  delta: { ...empty(), add: [
    { kind: 'task', localId: 'task', category: 'non_study', title: '資料' },
    ...[['total', 'scope_total', 20], ['completed', 'completed', 10]].map(([localId, quantityRole, amount]) => ({
      kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null, quantityRole, amount,
      unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
    })),
  ] },
};

/** Real runtime interpreter, binder and owner checkpoint; only provider/renderer I/O is scripted. */
function harness(focusedReadings: unknown[], nativeAnswers: unknown[]) {
  const memory = createMemoryStorageHarness();
  const newLocal = () => createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId,
    weekStartDate: scope.weekStartDate, storage: memory.storage });
  let local = newLocal();
  const slots = new Map<string, string>();
  const saved = vi.fn(async () => ({ planId: 'unexpected-save' }));
  const nativeInputs: Array<Record<string, unknown>> = [];
  const focusedInputs: unknown[] = [];
  let first = true;
  let turnId = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    approvalLedger: { read: () => slots.get('ledger') ?? null, write: raw => { slots.set('ledger', raw); } },
    plans: { findExistingPlanId: async () => undefined, saveBlock: saved },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => '2026-11-02T09:00:00.000Z',
    interpret: createWeeklyPlanningVNextRuntimeInterpreter(scope, { choice: {
      policy: VNEXT_OPTION_CHOICE_POLICY, choose: async () => { throw new Error('open-value question has no candidate menu'); },
    } }),
    client: { async createChatCompletion(request) {
      if (request.responseFormat === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5) {
        focusedInputs.push(request.decisionContext);
        if (!focusedReadings.length) throw new Error('focused script exhausted');
        return JSON.stringify(focusedReadings.shift());
      }
      nativeInputs.push(JSON.parse(request.messages[1].content));
      if (first) { first = false; return JSON.stringify(initialReading); }
      if (!nativeAnswers.length) throw new Error('native script exhausted');
      return JSON.stringify({ planningIntent: 'unknown', conversationActs: [], delta: empty(), answer: nativeAnswers.shift() });
    } },
    // Fault injection: an ungrounded number in presentation, with no typed numeric proposal.
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: reply, rawResponse: '' }) }),
  };
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
    turnId: `numeric-turn-${++turnId}`, shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  const state = () => local.readCheckpoint()!.vnext.state;
  return { turn, state, saved, nativeInputs, focusedInputs, checkpoint: () => local.readCheckpoint()!,
    reload() { local = newLocal(); ports.checkpoint = local.checkpoint; } };
}

describe('#916 renderer numbers and interpreted answers at the real VNext session boundary', () => {
  it.each(['はい', '違う'])('does not create an estimate from renderer prose when both readers abstain: %s', async userText => {
    const h = harness([fallback, perUnit], [null]);
    const first = await h.turn('資料は全20枚のうち10枚終わっています。計画を作ってください。');
    expect(first.question).toMatchObject({ code: 'missing_effort_estimate', options: [] });
    expect(h.checkpoint().vnext.presentedQuestion?.shownText).toBe(reply);
    expect(h.state().graph.effortEstimates).toEqual([]);
    const facts = structuredClone(h.state().graph.workloads);
    h.reload();

    const answered = await h.turn(userText);
    expect(answered.question?.code).toBe('missing_effort_estimate');
    expect(h.nativeInputs[1]).toMatchObject({ presentedText: reply, userText });
    expect(h.state().graph.effortEstimates).toEqual([]);
    expect(h.state().graph.workloads).toEqual(facts);
    expect(answered.preview).toBeNull();
    expect(h.saved).not.toHaveBeenCalled();

    await h.turn('1枚8分です');
    expect(projectWeeklyPlanningVNext(h.state()).owners[0].work).toMatchObject([{ amount: 10, minutes: 80 }]);
    expect(h.state().graph.effortEstimates).toMatchObject([{ kind: 'duration_per_unit', minutes: 8 }]);
    expect(h.saved).not.toHaveBeenCalled();
  });

  it.each(['はい', '違う'])('characterizes a fabricated semantic estimate after focused fallback (not real-model evidence): %s', async userText => {
    const h = harness([fallback], [{ kind: 'estimate_minutes', optionId: null, minutes: 96, per: 'whole_work' }]);
    await h.turn('資料は全20枚のうち10枚終わっています。計画を作ってください。');
    expect(h.state().graph.effortEstimates).toEqual([]);

    const result = await h.turn(userText);
    // This path requires a fabricated typed claim by the reader; the renderer never writes the fact itself.
    // Do not mistake this injected semantic error for proof that a real provider makes the same reading.
    expect(result.interpretation).toMatchObject({ status: 'interpreted', answer: { kind: 'estimate_minutes', minutes: 96 } });
    expect(h.state().graph.effortEstimates).toMatchObject([{ kind: 'total_duration', minutes: 96,
      source: { sourceText: userText } }]);
    expect(projectWeeklyPlanningVNext(h.state()).owners[0].work).toMatchObject([{ amount: 10, minutes: 96 }]);
    expect(h.saved).not.toHaveBeenCalled();
  });

  it('binds an explicit per-unit answer to the asked work rather than the number in the rendered reply', async () => {
    const h = harness([perUnit], []);
    await h.turn('資料は全20枚のうち10枚終わっています。計画を作ってください。');
    await h.turn('1枚8分です');
    expect(h.nativeInputs).toHaveLength(1);
    expect(h.focusedInputs).toHaveLength(1);
    expect(projectWeeklyPlanningVNext(h.state()).owners[0].work).toMatchObject([{ amount: 10, minutes: 80 }]);
    expect(h.state().graph.effortEstimates).toMatchObject([{ kind: 'duration_per_unit', minutes: 8 }]);
    expect(h.saved).not.toHaveBeenCalled();
  });
});
