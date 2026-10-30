import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanDraftBlock } from '../../types';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationInput,
} from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { resolveWeeklyPlanningDateExpressionsV5 } from '../../semantic/weeklyPlanningResolvedDateExpressionsV5';
import {
  approveWeeklyPlanningVNextExperimentalPreview,
  readWeeklyPlanningVNextExperimentalSession,
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from '../application/weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'owner-1',
  weekStartDate: '2026-11-02',
  conversationId: 'v5-port-comparison',
  clock: {
    currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
  },
  notBeforeTime: '09:00',
};

const emptyDelta = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const interpreted = (delta: VNextTurnDelta): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', delta, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});
const task = (localId: string, title = localId): VNextAddFact => ({
  kind: 'task', localId, category: 'study', title,
});
const work = (localId: string, taskLocalId: string, amount = 60, perOccurrence = false): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: taskLocalId }, componentRef: null, quantityRole: 'target',
  amount, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence, periodExpression: null,
});
const window = (localId: string, start: string, end: string): VNextAddFact => ({
  kind: 'planning_window', localId, windowKind: 'absolute', value: `${start}/${end}`, start, end,
});

type ScriptStep = VNextTurnDelta | ((input: WeeklyPlanningVNextInterpretationInput) => VNextTurnDelta);

function harness(script: ScriptStep[], sessionScope: WeeklyPlanningVNextExperimentalScope = scope) {
  const slots = new Map<string, string>();
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  let saveCalls = 0;
  let shownRevision: number | null = null;
  const slot = (key: string) => ({
    read: () => slots.get(key) ?? null,
    write: (raw: string) => { slots.set(key, raw); },
  });
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: {} as OpenAiCompatibleClient,
    async interpret(input) {
      const step = script.shift();
      if (!step) throw new Error('VNext V5 port script exhausted');
      return interpreted(typeof step === 'function' ? step(input) : step);
    },
    checkpoint: slot('vnext'),
    legacyV5Checkpoint: { read: slot('v5').read },
    approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(sourceDraftBlockId) {
        return saved.has(sourceDraftBlockId) ? `plan:${sourceDraftBlockId}` : undefined;
      },
      async saveBlock(block) {
        saveCalls += 1;
        saved.set(block.id, block);
        return { planId: `plan:${block.id}` };
      },
    },
    calendar: () => ({ plans: [], monthEvents: [], scheduleTemplates: [] }),
    renderer: { async render(input) { return { status: 'rendered', text: `rendered:${input.actionKind}`, rawResponse: '' }; } },
    now: () => '2026-11-02T08:00:00.000Z',
  };
  return {
    ports,
    saved,
    saveCalls: () => saveCalls,
    async turn(turnId: string, userText: string) {
      const result = await submitWeeklyPlanningVNextExperimentalTurn({
        scope: sessionScope, ports, turnId, userText, shownRevision,
      });
      if (result.graphRevision !== null) shownRevision = result.graphRevision;
      return result;
    },
  };
}

async function applyCorrectSaveAndReload(params: {
  initial: VNextTurnDelta;
  correction: (input: WeeklyPlanningVNextInterpretationInput) => VNextTurnDelta;
  checkInitialPreview: (blocks: WeeklyPlanDraftBlock[]) => void;
  checkInitialState?: (state: unknown) => void;
  checkCorrectedPreview: (blocks: WeeklyPlanDraftBlock[]) => void;
  checkState: (state: unknown) => void;
}) {
  const h = harness([params.initial, params.correction]);
  const first = await h.turn('initial', 'stated facts');
  expect(first).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
  expect(first.preview, JSON.stringify(first)).not.toBeNull();
  params.checkInitialPreview(first.preview!.blocks);
  if (params.checkInitialState) {
    const initialRead = readWeeklyPlanningVNextExperimentalSession(scope, h.ports);
    expect(initialRead.status).toBe('ready');
    if (initialRead.status !== 'ready') throw new Error('VNext initial checkpoint did not reload');
    params.checkInitialState(initialRead.checkpoint.state);
  }

  const corrected = await h.turn('correction', 'correction');
  expect(corrected).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
  expect(corrected.preview).not.toBeNull();
  expect(corrected.preview!.blocks).not.toEqual(first.preview!.blocks);
  params.checkCorrectedPreview(corrected.preview!.blocks);

  const approval = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports });
  expect(approval.status).toBe('executed');
  if (approval.status !== 'executed') throw new Error(`approval rejected: ${approval.reason}`);
  expect(approval.operation.status).toBe('completed');
  expect(h.saveCalls()).toBe(corrected.preview!.blocks.length);

  const loaded = readWeeklyPlanningVNextExperimentalSession(scope, h.ports);
  expect(loaded.status).toBe('ready');
  if (loaded.status !== 'ready') throw new Error('VNext checkpoint did not reload');
  expect(loaded.source).toBe('vnext');
  expect(loaded.checkpoint.preview).toEqual(corrected.preview);
  params.checkState(loaded.checkpoint.state);
  const saveCount = h.saveCalls();
  const repeatedApproval = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports });
  expect(repeatedApproval).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
  expect(h.saveCalls()).toBe(saveCount);
}

const orderedBlocks = (blocks: WeeklyPlanDraftBlock[]) => [...blocks]
  .sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime));
const dates = (blocks: WeeklyPlanDraftBlock[]) => orderedBlocks(blocks).map(block => block.date);

describe('V5 scheduling regressions through VNext transaction, session, and Stable V5 scheduler', () => {
  it('resolves next_week from a Sunday-start session week', async () => {
    const sundayScope: WeeklyPlanningVNextExperimentalScope = {
      ...scope,
      weekStartDate: '2026-11-01',
      conversationId: 'v5-port-sunday-next-week',
      clock: { ...scope.clock, currentDate: '2026-11-02', planningStartDate: '2026-11-01',
        planningEndDate: '2026-11-07', weekStartsOn: 'sunday' },
    };
    const h = harness([{ ...emptyDelta(), add: [task('english', '英語の音読'), work('reading', 'english'), {
      kind: 'planning_window', localId: 'next-week', windowKind: 'relative_week', value: 'next_week', start: null, end: null,
    }] }], sundayScope);
    const result = await h.turn('next-week', '来週の計画');
    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready' });
    expect(result.preview).not.toBeNull();
    expect(dates(result.preview!.blocks)[0]).toBe('2026-11-08');
    const loaded = readWeeklyPlanningVNextExperimentalSession(sundayScope, h.ports);
    expect(loaded.status).toBe('ready');
    if (loaded.status === 'ready') expect(loaded.checkpoint.state.graph.planningWindows).toMatchObject([
      { kind: 'absolute', start: '2026-11-08', end: '2026-11-14' },
    ]);
  });

  it('keeps the accepted hard Friday deadline when a later amount correction advances the clock', async () => {
    const initial: VNextTurnDelta = { ...emptyDelta(), add: [task('math', '数学'), work('math-work', 'math'),
      window('fortnight', '2026-11-02', '2026-11-15'), {
        kind: 'temporal_constraint', localId: 'friday-deadline', taskRef: { localId: 'math' }, targetRef: { localId: 'math' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'weekday:friday',
        namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact',
      }] };
    const deadlineScope: WeeklyPlanningVNextExperimentalScope = {
      ...scope, conversationId: 'v5-port-expired-hard-deadline',
      clock: { ...scope.clock, planningEndDate: '2026-11-15' },
    };
    const h = harness([initial, input => ({ ...emptyDelta(), patch: [{ kind: 'workload', localId: 'amount-correction',
      targetFactId: input.state.graph.workloads[0].id,
      amountDelta: 30,
      changes: { amount: null, quantityRole: null, unitCode: null, unitLabel: null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null },
    }] })], deadlineScope);
    const first = await h.turn('initial', '金曜が締切です');
    expect(first).toMatchObject({ outcome: 'applied', readiness: 'ready' });
    expect(first.preview).not.toBeNull();
    expect(dates(first.preview!.blocks)).toEqual(['2026-11-02']);

    deadlineScope.clock.currentDate = '2026-11-07';
    const corrected = await h.turn('correction', '作業量は90分です');
    expect(corrected).toMatchObject({ outcome: 'applied' });
    expect(corrected.preview).toBeNull();
    const loaded = readWeeklyPlanningVNextExperimentalSession(deadlineScope, h.ports);
    expect(loaded.status).toBe('ready');
    if (loaded.status === 'ready') {
      expect(loaded.checkpoint.state.graph.temporalConstraints).toMatchObject([
        expect.objectContaining({ kind: 'deadline', dateExpression: '2026-11-06', constraintLevel: 'hard', endTime: '13:00' }),
      ]);
    }
  });

  it('resolves and corrects a relative planning window through the session horizon', async () => {
    await applyCorrectSaveAndReload({
      initial: { ...emptyDelta(), add: [task('english', '英語の音読'), work('reading', 'english'), {
        kind: 'planning_window', localId: 'window', windowKind: 'relative_week', value: 'next_week', start: null, end: null,
      }] },
      correction: input => ({ ...emptyDelta(), patch: [{ kind: 'planning_window', localId: 'move-window',
        targetFactId: input.state.graph.planningWindows[0].id,
        changes: { windowKind: 'absolute', value: '2026-11-16/2026-11-22', start: '2026-11-16', end: '2026-11-22' },
      }] }),
      checkInitialPreview: blocks => expect(dates(blocks)).toEqual(['2026-11-09']),
      checkCorrectedPreview: blocks => expect(dates(blocks)).toEqual(['2026-11-16']),
      checkState: state => {
        const planningWindows = (state as WeeklyPlanningVNextState).graph.planningWindows;
        expect(planningWindows[planningWindows.length - 1])
          .toMatchObject({ kind: 'absolute', value: '2026-11-16/2026-11-22', start: '2026-11-16', end: '2026-11-22' });
      },
    });
  });

  it('schedules a complete per-occurrence workload and corrects recurrence days', async () => {
    await applyCorrectSaveAndReload({
      initial: { ...emptyDelta(), add: [task('math', '模試対策'), work('daily-work', 'math', 120, true), {
        kind: 'recurrence', localId: 'daily', taskRef: { localId: 'math' }, targetRef: { localId: 'math' },
        recurrenceKind: 'daily', count: null, days: [],
      }] },
      correction: input => ({ ...emptyDelta(), patch: [{ kind: 'recurrence', localId: 'weekly-days',
        targetFactId: input.state.graph.recurrences[0].id,
        changes: { recurrenceKind: 'weekly', count: null, days: ['weekday:monday', 'weekday:wednesday', 'weekday:friday'] },
      }] }),
      checkInitialPreview: blocks => {
        expect(dates(blocks)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
        expect(blocks.every(block => block.startTime && block.endTime)).toBe(true);
      },
      checkCorrectedPreview: blocks => expect(dates(blocks)).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']),
      checkState: state => {
        const recurrences = (state as WeeklyPlanningVNextState).graph.recurrences;
        expect(recurrences[recurrences.length - 1]).toMatchObject({ kind: 'weekly', days: ['weekday:monday', 'weekday:wednesday', 'weekday:friday'] });
      },
    });
  });

  it('excludes Monday in each week of a two-week horizon and corrects the weekday rule', async () => {
    await applyCorrectSaveAndReload({
      initial: { ...emptyDelta(), add: [task('worksheets', '数学プリント'), work('daily-work', 'worksheets'),
        window('two-weeks', '2026-11-09', '2026-11-22'),
        { kind: 'task_date_rule', localId: 'no-mondays', taskRef: { localId: 'worksheets' }, targetRef: { localId: 'worksheets' },
          ruleKind: 'excluded_date', dateExpression: 'weekday:monday', constraintLevel: 'hard' },
      ] },
      correction: input => ({ ...emptyDelta(), patch: [{ kind: 'task_date_rule', localId: 'allow-one-day',
        targetFactId: input.state.graph.taskDateRules[0].id,
        changes: { ruleKind: null, dateExpression: 'weekday:friday', constraintLevel: null },
      }] }),
      checkInitialPreview: blocks => expect(dates(blocks)).toEqual(['2026-11-10']),
      checkInitialState: state => {
        const graph = (state as WeeklyPlanningVNextState).graph;
        const acceptedWindow = graph.planningWindows[0];
        if (!acceptedWindow.start || !acceptedWindow.end) throw new Error('expected an absolute two-week window');
        const resolved = resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate: '2026-11-02',
          planningWindow: { startDate: acceptedWindow.start, endDate: acceptedWindow.end } });
        expect(resolved.facts.find(fact => fact.factId === graph.taskDateRules[0].id))
          .toMatchObject({ dates: ['2026-11-09', '2026-11-16'] });
      },
      checkCorrectedPreview: blocks => expect(dates(blocks)).toEqual(['2026-11-09']),
      checkState: state => {
        const rules = (state as WeeklyPlanningVNextState).graph.taskDateRules;
        expect(rules[rules.length - 1]).toMatchObject({ kind: 'excluded_date', dateExpression: 'weekday:friday', targetFactId: expect.any(String) });
      },
    });
  });

  it('applies and corrects a hard unavailable interval from the availability declaration', async () => {
    await applyCorrectSaveAndReload({
      initial: { ...emptyDelta(), add: [task('study', '英語'), work('study-work', 'study'), window('one-day', '2026-11-03', '2026-11-03'), {
        kind: 'availability_declaration', localId: 'blocked-morning', availabilityKind: 'unavailable', dateExpression: '2026-11-03',
        namedTimePeriod: null, startTime: '09:00', endTime: '10:00', recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard',
      }] },
      correction: input => ({ ...emptyDelta(), patch: [{ kind: 'availability_declaration', localId: 'longer-block',
        targetFactId: input.state.graph.availabilityDeclarations[0].id,
        changes: { availabilityKind: null, dateExpression: null, namedTimePeriod: null, startTime: null, endTime: '11:00',
          recurrenceKind: null, days: null, capacityMinutes: null, constraintLevel: null },
      }] }),
      checkInitialPreview: blocks => expect(orderedBlocks(blocks).map(block => [block.date, block.startTime, block.endTime]))
        .toEqual([['2026-11-03', '10:10', '11:10']]),
      checkCorrectedPreview: blocks => expect(orderedBlocks(blocks).map(block => [block.date, block.startTime, block.endTime]))
        .toEqual([['2026-11-03', '11:10', '12:10']]),
      checkState: state => {
        const declarations = (state as WeeklyPlanningVNextState).graph.availabilityDeclarations;
        expect(declarations[declarations.length - 1]).toMatchObject({ kind: 'unavailable', startTime: '09:00', endTime: '11:00', resolutionStatus: 'unresolved' });
      },
    });
  });

  it('orders tasks by a relation, then reverses the order after correction', async () => {
    await applyCorrectSaveAndReload({
      initial: { ...emptyDelta(), add: [task('math', '数学'), task('english', '英語'), work('math-work', 'math', 30), work('english-work', 'english', 30), {
        kind: 'relation', localId: 'english-first', relationKind: 'before', fromTaskRef: { localId: 'english' }, toTaskRef: { localId: 'math' },
      }] },
      correction: input => ({ ...emptyDelta(), patch: [{ kind: 'relation', localId: 'math-first',
        targetFactId: input.state.graph.relations[0].id, changes: { relationKind: 'after' },
      }] }),
      checkInitialPreview: blocks => expect(orderedBlocks(blocks).map(block => block.title)).toEqual(['英語 30分', '数学 30分']),
      checkCorrectedPreview: blocks => expect(orderedBlocks(blocks).map(block => block.title)).toEqual(['数学 30分', '英語 30分']),
      checkState: state => {
        const relations = (state as WeeklyPlanningVNextState).graph.relations;
        expect(relations[relations.length - 1]).toMatchObject({ kind: 'after', fromTaskId: expect.any(String), toTaskId: expect.any(String) });
      },
    });
  });
});
