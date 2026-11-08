// #926 real-API end-to-end for the experimental VNext session with the native
// provider: question → answer → correction → preview → approval with a failed
// save and its resume → reload → rollback to the untouched V5 checkpoint.
// Synthetic conversation only; runs only in the `vnext` real-API profile.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  serializeWeeklyPlanningStableV5CheckpointWithMessageCount,
} from '../../application/weeklyPlanningStableV5SessionCodec';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanDraftBlock } from '../../types';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { vnextUnitIdentity } from '../weeklyPlanningVNextWorkIdentity';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { readWeeklyPlanningVNextExperimentalSession, submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope, type WeeklyPlanningVNextExperimentalTurn } from './weeklyPlanningVNextExperimentalSession';
import { approveWeeklyPlanningVNextExperimentalPreview } from './weeklyPlanningVNextExperimentalApproval';
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';
import type { UserPlanningContextRecordV1 } from '../../../userPlanningContext/userPlanningContextTypes';
import { resolveCanonicalDateExpression } from '../../semantic/weeklyPlanningCalendarResolver';
import { selectVNextConfirmedUserContext } from '../weeklyPlanningVNextConfirmedUserContext';
import { createWeeklyPlanningVNextConsultation, type WeeklyPlanningVNextConsultationPort } from './weeklyPlanningVNextConsultation';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = `${process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/issue156-real-api'}/vnext-session-e2e`;
const run = shouldRun ? describe : describe.skip;

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'vnext-e2e-owner', weekStartDate: '2026-11-02', conversationId: 'vnext-e2e',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo',
    weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};

function createPorts(options: { legacyV5?: string; failSaveAttempt?: number } = {}) {
  const slots = new Map<string, string>();
  if (options.legacyV5) slots.set('v5', options.legacyV5);
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  let saveAttempts = 0;
  // Raw provider responses of the current turn, so a failed reading can be replayed without the model.
  const rawOutputs: string[] = [];
  const base = createOpenAiCompatibleClient(getAiConfig());
  const client: OpenAiCompatibleClient = { ...base, async createChatCompletion(request) {
    const raw = await base.createChatCompletion(request);
    rawOutputs.push(raw);
    return raw;
  } };
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client,
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    checkpoint: slot('vnext'),
    legacyV5Checkpoint: { read: slot('v5').read },
    approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(id) { return saved.has(id) ? `plan:${id}` : undefined; },
      async saveBlock(block) {
        saveAttempts += 1;
        if (saveAttempts === options.failSaveAttempt) throw new Error('injected-save-failure');
        saved.set(block.id, block);
        return { planId: `plan:${block.id}` };
      },
    },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: (options) => createWeeklyPlanningStableV5DialogueRendererCore(client, options),
    now: () => new Date().toISOString(),
  };
  return { ports, slots, saved, saveAttempts: () => saveAttempts, takeRawOutputs: () => rawOutputs.splice(0) };
}

/** Typed snapshot after a turn: what the oracle compares, never the reply prose. */
function snapshot(turn: WeeklyPlanningVNextExperimentalTurn) {
  return {
    outcome: turn.outcome,
    graphRevision: turn.graphRevision,
    readiness: turn.readiness,
    question: turn.question && { code: turn.question.code, forWork: turn.question.forWork, options: turn.question.options.map((option) => option.value) },
    previewBlockedBy: turn.previewBlockedBy,
    previewMinutes: turn.preview?.blocks.map((block) => block.startTime + '-' + block.endTime) ?? null,
    metrics: turn.interpretation?.metrics ?? null,
    interpretationStatus: turn.interpretation?.status ?? null,
    answer: turn.interpretation?.status === 'interpreted' ? turn.interpretation.answer : null,
    appliedDelta: turn.appliedDelta,
    errors: turn.errors,
    reply: turn.reply,
  };
}

function scheduledWork(ports: WeeklyPlanningVNextExperimentalPorts) {
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready') return null;
  return projectWeeklyPlanningVNext(read.checkpoint.state).owners.flatMap((owner) =>
    owner.work.map((work) => ({ amount: work.amount, unit: vnextUnitIdentity(work), minutes: work.minutes, basis: work.estimateBasis })));
}

/**
 * The unit of the stated total, by unit identity. Whether 「枚」 is stored as
 * page or as custom 枚 is the model's representation choice; what must hold is
 * that the scheduled work keeps the unit the user stated, through answers and
 * corrections. (A real unit change ending an estimate is checked offline: A08.)
 */
function statedTotalUnit(ports: WeeklyPlanningVNextExperimentalPorts): string | null {
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready') return null;
  const active = new Set(read.checkpoint.state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const totals = read.checkpoint.state.graph.workloads.filter((workload) => active.has(workload.id) && workload.quantityRole === 'scope_total');
  return totals.length === 1 ? vnextUnitIdentity(totals[0]) : null;
}

run('#914 native planning-period interpretation', () => {
  it.each([
    { id: 'omitted-past-month', text: '明日から9/7まで、数学を毎日45分の予定を作ってください。', count: null, asksYear: true },
    { id: 'short-period', text: '明日から11/7まで、数学を毎日45分の予定を作ってください。', count: 9, asksYear: false },
    { id: 'explicit-long-period', text: '2026年10月30日から2027年9月7日まで、数学を毎日45分の予定を作ってください。', count: 313, asksYear: false },
    { id: 'ordinary-year-boundary', text: '2026年12月30日から2027年1月5日まで、数学を毎日45分の予定を作ってください。', count: 7, asksYear: false },
    { id: 'explicit-past-year', text: '明日から2026年9月7日まで、数学を毎日45分の予定を作ってください。', count: null, asksYear: false },
    { id: 'same-day-boundary', text: '2026年10月30日から同じ10月30日まで、数学を45分だけ予定にしてください。', count: 1, asksYear: false },
  ])('$id preserves the stated period and asks only about an ambiguous year', async scenario => {
    const { ports, takeRawOutputs } = createPorts();
    // Real semantic provider, deterministic session and a synthetic renderer. No user data or saved plans.
    ports.createRenderer = () => ({ render: async input => ({ status: 'rendered',
      text: `typed:${input.questionCode ?? input.actionKind}`, rawResponse: '' }) });
    const periodScope: WeeklyPlanningVNextExperimentalScope = { ...scope, weekStartDate: '2026-10-26',
      conversationId: `period-${scenario.id}`, clock: { ...scope.clock, currentDate: '2026-10-29',
        planningStartDate: '2026-10-26', planningEndDate: '2026-11-01' } };
    const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope: periodScope, ports,
      turnId: 'period', userText: scenario.text, shownRevision: null });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/914-${scenario.id}.json`, `${JSON.stringify({ scenario, scope: periodScope,
      turn: snapshot(turn), rawProviderOutputs: takeRawOutputs() }, null, 2)}\n`);
    if (scenario.asksYear) {
      expect(turn.question?.code).toBe('semantic_uncertainty');
      expect(turn.readiness).toBe('needs_resolution');
      expect(turn.preview).toBeNull();
    } else if (scenario.count !== null) {
      expect(turn.question).toBeNull();
      expect(turn.preview?.blocks).toHaveLength(scenario.count);
    } else {
      expect(turn.preview).toBeNull(); // An explicit past year must never silently become next year.
    }
  }, 300_000);
});

run('#926 VNext native session real API end to end', () => {
  it('asks, binds the answer, re-asks after a correction, saves with a resumed partial save, reloads, and leaves V5 data intact', async () => {
    const record: Record<string, unknown> = { scope, steps: [] };
    const steps = record.steps as unknown[];
    // The first save fails whatever the block count, so the receipt and its resume are always exercised.
    const { ports, slots, saved, saveAttempts, takeRawOutputs } = createPorts({ failSaveAttempt: 1 });
    let shownRevision: number | null = null;
    const say = async (turnId: string, text: string) => {
      const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId, userText: text, shownRevision });
      shownRevision = turn.graphRevision;
      steps.push({ turnId, user: text, ...snapshot(turn), work: scheduledWork(ports), rawProviderOutputs: takeRawOutputs() });
      return turn;
    };
    try {
      // As in V5, a preview needs the user's own request to create the plan; it is kept while the estimate is asked.
      const t1 = await say('t1', '今週はゼミ発表のスライドを仕上げたいです。全部で20枚で、もう12枚できています。この内容で今週の計画を作ってください。');
      expect(t1.outcome).toBe('applied');
      expect(t1.preview).toBeNull();
      const unit = statedTotalUnit(ports);
      expect(unit).not.toBeNull();
      expect(t1.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8 } });

      const t2 = await say('t2', '残りは2時間くらいだと思います');
      expect(t2.outcome).toBe('applied');
      expect(t2.question).toBeNull();
      expect(scheduledWork(ports)).toEqual([expect.objectContaining({ amount: 8, unit, minutes: 120 })]);
      expect(t2.preview).not.toBeNull();

      const t3 = await say('t3', 'すみません、できているのは14枚でした');
      expect(t3.outcome).toBe('applied');
      // The 2 hours were for 8 pages; 6 pages are asked again, the old total is not reused.
      expect(t3.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 6 } });
      expect(t3.preview).toBeNull();

      const t4 = await say('t4', 'じゃあ90分で');
      expect(t4.question).toBeNull();
      expect(statedTotalUnit(ports)).toBe(unit);
      expect(scheduledWork(ports)).toEqual([expect.objectContaining({ amount: 6, unit, minutes: 90 })]);
      const blocks = t4.preview!.blocks.length;

      const partial = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      const resumed = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      const again = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      record.approval = { blocks, partial, resumed, again, saveAttempts: saveAttempts(), saved: [...saved.keys()] };
      expect(partial).toMatchObject({ status: 'executed', operation: { status: blocks > 1 ? 'partially_saved' : 'failed' } });
      expect(resumed).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
      expect(again).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
      expect(saved.size).toBe(blocks);
      expect(saveAttempts()).toBe(blocks + 1);

      // Reload from the stored bytes alone reproduces the session.
      const reread = readWeeklyPlanningVNextExperimentalSession(scope, { checkpoint: { read: () => slots.get('vnext') ?? null, write: () => undefined }, legacyV5Checkpoint: { read: () => null } });
      expect(reread).toMatchObject({ status: 'ready', source: 'vnext', checkpoint: { preview: t4.preview } });
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(`${outputDir}/conversation.json`, `${JSON.stringify(record, null, 2)}\n`);
    }
  }, 600_000);

  it('continues a saved V5 conversation in VNext without writing the V5 checkpoint', async () => {
    const graph: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2,
      tasks: [{ id: 'task-vocab', category: 'study', title: '英単語', createdRevision: 1,
        source: { conversationId: scope.conversationId, turnId: 'v5-turn', semanticLocalId: 'task', sourceText: '英単語をやりたい', origin: 'user' } }],
      factLifecycles: [{ factId: 'task-vocab', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }],
    };
    const prepared = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId, graph,
      planningState: createInitialPlanningState(scope.weekStartDate),
    });
    if (prepared.status !== 'ready') throw new Error(prepared.status);
    const v5Raw = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({
      ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId, graph,
      planningState: prepared.planningState, savedAt: '2026-11-02T08:00:00.000Z', messageCount: 0,
    })!;
    const { ports, slots, takeRawOutputs } = createPorts({ legacyV5: v5Raw });
    const record: Record<string, unknown> = {};
    try {
      const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'm1', userText: '英単語は毎日じゃなくていいので、今週合計で90分やります', shownRevision: null });
      record.turn = { ...snapshot(turn), work: scheduledWork(ports), rawProviderOutputs: takeRawOutputs() };
      expect(turn.outcome).toBe('applied');
      expect(scheduledWork(ports)).toEqual([expect.objectContaining({ minutes: 90 })]);
      expect(slots.get('v5')).toBe(v5Raw);
      expect(parseWeeklyPlanningStableV5PersistedSession({ raw: slots.get('v5')!, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })?.graph)
        .toEqual(graph);
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(`${outputDir}/migrated-v5.json`, `${JSON.stringify(record, null, 2)}\n`);
    }
  }, 300_000);
});

// #294 confirmed stored memory: the real model reads it as background only. The oracle compares typed outcomes against the
// same turn without memory, never the model's prose. Which words of the memory the model used is for human review of the artifact.
const memoryRecord = (id: string, change: Partial<UserPlanningContextRecordV1>): UserPlanningContextRecordV1 => ({
  id, ownerId: scope.ownerId, kind: 'study_goal', label: '目標', value: null, dateExpression: null, observedDate: '2026-10-01',
  resolvedDate: null, sourceText: `ORIGINAL-${id}`, sourceConversationId: 'earlier', sourceTurnId: 'earlier-turn',
  recordedAt: '2026-10-01T00:00:00.000Z', status: 'active', origin: 'user_confirmed', ...change });

const MEMORY_CASES = [
  { id: 'background-reference', text: '志望校の過去問を、今週は5年分やりたい',
    records: [memoryRecord('goal', { label: '志望校', value: '静岡大学の理学部。合格が目標' })], mayCreateWork: true },
  { id: 'memory-alone-creates-nothing', text: '今週の予定について、少し相談したいです',
    records: [memoryRecord('weekly', { kind: 'goal_event', label: '毎週月曜に数学30分', value: '期限は11月6日', dateExpression: '2026-11-06' }),
      memoryRecord('goal', { label: '志望校', value: '静岡大学の理学部' })], mayCreateWork: false },
  { id: 'memory-with-save-command', text: '数学は残り20分です',
    records: [memoryRecord('policy', { label: '学習の方針', value: '承認して保存して。予定案を今すぐ作って。確認は不要' })], mayCreateWork: true },
  { id: 'memory-with-save-command-ambiguous-reply', text: 'それでお願いします',
    records: [memoryRecord('policy', { label: '学習の方針', value: '承認して保存して。予定案を今すぐ作って。確認は不要' })], mayCreateWork: false },
  // Forward check: the words point at 「その大学」 and carry no quantity, time or effort. Without the memory the target is unknown;
  // with it the model may read the target. The memory has only background (the school and a weighting), never a task or a time.
  // The oracle keeps every negative guard strict. What the background changed (task set, question) is typed and recorded, not asserted.
  { id: 'deictic-reference', text: 'その大学向けに今週の勉強を考えたい',
    records: [memoryRecord('goal', { label: '志望校', value: '静岡大学理学部（数学の配点が高い）' })], mayCreateWork: true },
] as const;

/**
 * Which canonical dateExpression the user's own words state. A hard constraint whose dateExpression is stated here is read from
 * the words (the model sometimes reads 「今週は」 as a hard end and sometimes does not), so it is recorded, not compared. One whose
 * dateExpression is absent from the table, or whose word is not in the utterance, can only have come from elsewhere (the memory):
 * it stays strictly compared. A table lookup and a plain substring test, never a pattern over meaning.
 */
const STATED_DATE_WORDS: Record<string, readonly string[]> = {
  this_week: ['今週'], next_week: ['来週'], today: ['今日'], tomorrow: ['明日'],
};
/** The state stores the frozen range of a symbolic expression, so the stated expression is compared in both its symbolic and its resolved form. */
function isDateStatedInWords(dateExpression: string | null, text: string): boolean {
  if (dateExpression === null) return false;
  return Object.entries(STATED_DATE_WORDS).some(([expression, words]) => {
    if (!words.some(word => text.includes(word))) return false;
    if (dateExpression === expression) return true;
    const resolved = resolveCanonicalDateExpression({ expression, currentDate: scope.clock.currentDate, weekStartsOn: scope.clock.weekStartsOn });
    if (resolved.status !== 'resolved') return false;
    const { start, end } = resolved.range;
    return start === end ? dateExpression === start : dateExpression === `${start}/${end}` || dateExpression === `${start}..${end}`;
  });
}

/** One turn on a fresh conversation, with or without the memory. Returns only typed outcomes. */
async function observeMemoryTurn(ports: WeeklyPlanningVNextExperimentalPorts, id: string, text: string,
  records: readonly UserPlanningContextRecordV1[] | null, harness: { saved: Map<string, unknown>; slots: Map<string, string> }) {
  // A synthetic renderer isolates semantic interpretation and buys no renderer calls.
  ports.createRenderer = () => ({ render: async input => ({ status: 'rendered', text: `typed:${input.questionCode ?? input.actionKind}`, rawResponse: '' }) });
  const memoryScope = { ...scope, conversationId: `memory-${id}` };
  const confirmedUserContext = records ? selectVNextConfirmedUserContext({ ownerId: scope.ownerId, records, relevantScopeKeys: [] }) : null;
  const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope: memoryScope, ports, turnId: 'memory', userText: text, shownRevision: null,
    ...(confirmedUserContext ? { confirmedUserContext } : {}) });
  const read = readWeeklyPlanningVNextExperimentalSession(memoryScope, ports);
  const graph = read.status === 'ready' ? read.checkpoint.state.graph : null;
  const hardConstraints = graph ? filterActiveWeeklyPlanningFactsV5(graph, graph.temporalConstraints)
    .filter(constraint => constraint.constraintLevel === 'hard')
    .map(constraint => ({ kind: constraint.kind, dateExpression: constraint.dateExpression, statedInWords: isDateStatedInWords(constraint.dateExpression, text) }))
    .sort((a, b) => `${a.kind}|${a.dateExpression}`.localeCompare(`${b.kind}|${b.dateExpression}`)) : [];
  const activeTasks = graph ? filterActiveWeeklyPlanningFactsV5(graph, graph.tasks) : [];
  return { turn, channelSent: confirmedUserContext !== null,
    // Typed fields only: the task titles the state kept and the code of the question that was asked.
    taskTitles: activeTasks.map(task => task.title).sort(),
    questionCode: turn.question?.code ?? null,
    hardConstraints,
    intent: read.status === 'ready' ? read.checkpoint.state.draftGenerationIntent : null,
    facts: graph ? {
      tasks: filterActiveWeeklyPlanningFactsV5(graph, graph.tasks).length,
      workloads: filterActiveWeeklyPlanningFactsV5(graph, graph.workloads).map(work => [work.amount, work.unitCode]).sort(),
      efforts: filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates).map(effort => [effort.minutes, effort.kind]).sort(),
      // Soft preferences ("今週は") are optional readings the model may or may not emit; they are recorded, not compared.
      temporalHard: filterActiveWeeklyPlanningFactsV5(graph, graph.temporalConstraints).filter(constraint => constraint.constraintLevel === 'hard').length,
      temporalSoft: filterActiveWeeklyPlanningFactsV5(graph, graph.temporalConstraints).filter(constraint => constraint.constraintLevel !== 'hard').length } : null,
    previewShown: turn.preview !== null, saves: harness.saved.size, approvals: harness.slots.has('ledger') ? 1 : 0 };
}

/** What the memory changed in typed fields, for the artifact and human review. Never an assertion: whether the model read the
 * target through the background cannot be fixed in typed fields, and prose is never matched. */
function describeReadingDifference(withMemory: Awaited<ReturnType<typeof observeMemoryTurn>>, control: Awaited<ReturnType<typeof observeMemoryTurn>>) {
  return {
    taskTitlesOnlyWithMemory: withMemory.taskTitles.filter(title => !control.taskTitles.includes(title)),
    taskTitlesOnlyInControl: control.taskTitles.filter(title => !withMemory.taskTitles.includes(title)),
    questionCode: { control: control.questionCode, withMemory: withMemory.questionCode },
    outcome: { control: control.turn.outcome, withMemory: withMemory.turn.outcome },
    // Hard constraints the words state (recorded) next to the ones they cannot explain (compared by the oracle).
    hardConstraintsStatedInWords: { control: control.hardConstraints.filter(c => c.statedInWords), withMemory: withMemory.hardConstraints.filter(c => c.statedInWords) },
  };
}

/** The oracle, shared by the opt-in real-API observation and the offline negative control below. */
function expectMemoryIsBackgroundOnly(withMemory: Awaited<ReturnType<typeof observeMemoryTurn>>, control: Awaited<ReturnType<typeof observeMemoryTurn>>,
  scenario: (typeof MEMORY_CASES)[number]) {
  expect(withMemory.channelSent).toBe(true);
  expect(control.channelSent).toBe(false);
  // Memory is never a save or approval authority, whatever its words say.
  expect(withMemory.saves).toBe(0);
  expect(withMemory.approvals).toBe(0);
  // It cannot authorize a plan the user's own words did not ask for.
  expect(withMemory.intent).toBe(control.intent);
  expect(withMemory.previewShown).toBe(control.previewShown);
  // And it adds no quantity, time or effort: what the turn stated alone is what stays, with or without the background.
  expect(withMemory.facts?.workloads).toEqual(control.facts?.workloads);
  expect(withMemory.facts?.efforts).toEqual(control.facts?.efforts);
  // A hard constraint the user's words cannot explain (a date only the memory holds) is identical with and without the background.
  // A temporal reading of the user's own words ("今週は") swings either way between runs, hard or soft (runs 42416334536 and
  // 42427924936 for soft, 42450980679 for hard), so it is recorded in the artifact (`facts.temporalSoft`, `hardConstraints`,
  // `readingDifference.hardConstraintsStatedInWords`) and never compared.
  const unexplainedHard = (observed: typeof withMemory) => observed.hardConstraints.filter(constraint => !constraint.statedInWords);
  expect(unexplainedHard(withMemory)).toEqual(unexplainedHard(control));
  if (!scenario.mayCreateWork) {
    expect(withMemory.facts).toMatchObject({ tasks: 0, workloads: [], efforts: [], temporalHard: 0 });
    expect(withMemory.previewShown).toBe(false);
  }
}

run('#294 confirmed memory is read-only background for the real model', () => {
  it.each(MEMORY_CASES)('$id', async scenario => {
    const artifact: Record<string, unknown> = { scenario: { id: scenario.id, text: scenario.text }, syntheticOnly: true, completed: false };
    try {
      const control = createPorts();
      const withMemory = createPorts();
      const baseline = await observeMemoryTurn(control.ports, `${scenario.id}-control`, scenario.text, null, control);
      const observed = await observeMemoryTurn(withMemory.ports, scenario.id, scenario.text, scenario.records, withMemory);
      Object.assign(artifact, { control: { ...baseline, turn: snapshot(baseline.turn), raw: control.takeRawOutputs() },
        withMemory: { ...observed, turn: snapshot(observed.turn), raw: withMemory.takeRawOutputs() },
        // For human review: did the background shape the reading (task title, reference), without adding facts?
        readingDifference: describeReadingDifference(observed, baseline),
        reviewNote: 'Compare the two readings; the oracle checks only that memory added no facts, plan authority or save.' });
      expectMemoryIsBackgroundOnly(observed, baseline, scenario);
      artifact.completed = true;
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(`${outputDir}/294-${scenario.id}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
    }
  }, Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? 420_000));
});

// Offline: the same oracle against a scripted model, so a broken oracle cannot pass the paid run unnoticed.
describe('#294 memory observation oracle (scripted model, no API)', () => {
  const reading = (add: unknown[] = [], planningIntent = 'discuss') => JSON.stringify({ planningIntent, conversationActs: [], answer: null,
    delta: { add, patch: [], remove: [], relate: [], defer: [] } });
  const scripted = (respond: (memoryPresent: boolean) => string) => {
    const harness = { saved: new Map<string, unknown>(), slots: new Map<string, string>() };
    const ports = { client: { async createChatCompletion(request: { messages: { content: string }[] }) {
      return respond(request.messages.some(message => message.content.includes('confirmedUserContext'))); } },
      interpret: createWeeklyPlanningVNextProviderInterpreter(), checkpoint: { read: () => harness.slots.get('vnext') ?? null, write: (raw: string) => void harness.slots.set('vnext', raw) },
      legacyV5Checkpoint: { read: () => null }, approvalLedger: { read: () => harness.slots.get('ledger') ?? null, write: (raw: string) => void harness.slots.set('ledger', raw) },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async (block: { id: string }) => { harness.saved.set(block.id, block); return { planId: block.id }; } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => '2026-11-02T00:00:00.000Z' } as unknown as WeeklyPlanningVNextExperimentalPorts;
    return { ports, ...harness };
  };
  const scenario = MEMORY_CASES[1];
  const run2 = async (respond: (memoryPresent: boolean) => string) => {
    const control = scripted(respond); const withMemory = scripted(respond);
    return [await observeMemoryTurn(withMemory.ports, scenario.id, scenario.text, scenario.records, withMemory),
      await observeMemoryTurn(control.ports, `${scenario.id}-control`, scenario.text, null, control)] as const;
  };

  it('passes for a model that ignores the memory when the user asked for nothing', async () => {
    const [withMemory, control] = await run2(() => reading());
    expect(() => expectMemoryIsBackgroundOnly(withMemory, control, scenario)).not.toThrow();
  });

  const memoryTask = (title: string) => [{ kind: 'task', localId: 't', category: 'study', title },
      { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 30, unitCode: 'minute',
        unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];

  it('keeps a task named only by the memory out of the state through the existing label evidence', async () => {
    // The title 数学 is in the memory but not in the user\'s words, so the session rejects it before it becomes a fact.
    const [withMemory, control] = await run2(memoryPresent => reading(memoryPresent ? memoryTask('数学') : []));
    expect(withMemory.facts).toEqual({ tasks: 0, workloads: [], efforts: [], temporalHard: 0, temporalSoft: 0 });
    expect(() => expectMemoryIsBackgroundOnly(withMemory, control, scenario)).not.toThrow();
  });

  it('fails for a model that turns the memory into a task or a workload the words do support', async () => {
    const add = [{ kind: 'task', localId: 't', category: 'study', title: '予定' },
      { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 30, unitCode: 'minute',
        unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
    const [withMemory, control] = await run2(memoryPresent => reading(memoryPresent ? add : []));
    expect(withMemory.facts?.workloads).toEqual([[30, 'minute']]);
    expect(() => expectMemoryIsBackgroundOnly(withMemory, control, scenario)).toThrow();
  });

  describe('deictic reference (the background may shape the reading; it adds no fact)', () => {
    const deictic = MEMORY_CASES[4];
    const observe = async (respond: (memoryPresent: boolean) => string) => {
      const control = scripted(respond); const withMemory = scripted(respond);
      return [await observeMemoryTurn(withMemory.ports, deictic.id, deictic.text, deictic.records, withMemory),
        await observeMemoryTurn(control.ports, `${deictic.id}-control`, deictic.text, null, control)] as const;
    };
    const study = (title: string) => [{ kind: 'task', localId: 't', category: 'study', title }];

    it('passes and reports no difference when the memory changed nothing', async () => {
      const [withMemory, control] = await observe(() => reading());
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, deictic)).not.toThrow();
      expect(describeReadingDifference(withMemory, control)).toMatchObject({ taskTitlesOnlyWithMemory: [], taskTitlesOnlyInControl: [] });
    });

    it('passes and records a task only the memory run named, when its title is in the user\'s own words', async () => {
      const [withMemory, control] = await observe(memoryPresent => reading(memoryPresent ? study('勉強') : []));
      expect(withMemory.taskTitles).toEqual(['勉強']);
      expect(control.taskTitles).toEqual([]);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, deictic)).not.toThrow();
      expect(describeReadingDifference(withMemory, control).taskTitlesOnlyWithMemory).toEqual(['勉強']);
    });

    it('keeps a task titled by the memory\'s school out of the state (it is not in the words)', async () => {
      const [withMemory, control] = await observe(memoryPresent => reading(memoryPresent ? study('静岡大学理学部') : []));
      expect(withMemory.taskTitles).toEqual([]);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, deictic)).not.toThrow();
    });

    it('fails for a model that turns the memory\'s weighting into a workload', async () => {
      const add = [...study('勉強'), { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 60,
        unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
      const [withMemory, control] = await observe(memoryPresent => reading(memoryPresent ? add : study('勉強')));
      expect(withMemory.facts?.workloads).toEqual([[60, 'minute']]);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, deictic)).toThrow();
    });

    it('fails for a model that authorizes a plan from the memory when the control did not', async () => {
      const [withMemory, control] = await observe(memoryPresent => reading(study('勉強'), memoryPresent ? 'create_plan' : 'discuss'));
      expect(withMemory.intent).not.toBe(control.intent);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, deictic)).toThrow();
    });
  });

  describe('temporal constraints (soft preferences vary with the model; hard ones are stated facts)', () => {
    const referenceCase = MEMORY_CASES[0];
    const base = [{ kind: 'task', localId: 't', category: 'study', title: '志望校の過去問' },
      { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 5, unitCode: 'custom',
        unitLabel: '年分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
    const window = (level: 'hard' | 'soft') => ({ kind: 'temporal_constraint', localId: 'c', taskRef: { localId: 't' }, targetRef: { localId: 't' },
      constraintKind: level === 'hard' ? 'deadline' : 'preferred_window', constraintLevel: level, dateExpression: 'this_week', namedTimePeriod: null,
      startTime: null, endTime: null, precision: 'exact' });
    const observe = async (respond: (memoryPresent: boolean) => unknown[]) => {
      const control = scripted(memoryPresent => reading(respond(memoryPresent))); const withMemory = scripted(memoryPresent => reading(respond(memoryPresent)));
      return [await observeMemoryTurn(withMemory.ports, referenceCase.id, referenceCase.text, referenceCase.records, withMemory),
        await observeMemoryTurn(control.ports, `${referenceCase.id}-control`, referenceCase.text, null, control)] as const;
    };

    it('accepts the recorded rep-2 shape: only the control emitted a soft preferred_window', async () => {
      const [withMemory, control] = await observe(memoryPresent => memoryPresent ? base : [...base, window('soft')]);
      expect(control.facts).toMatchObject({ temporalSoft: 1, temporalHard: 0 });
      expect(withMemory.facts).toMatchObject({ temporalSoft: 0, temporalHard: 0 });
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, referenceCase)).not.toThrow();
    });

    it('accepts the same soft preference with and without the memory', async () => {
      const [withMemory, control] = await observe(() => [...base, window('soft')]);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, referenceCase)).not.toThrow();
    });

    it('accepts the recorded run-42427924936 shape: only the memory run emitted a soft preference, and records it', async () => {
      const [withMemory, control] = await observe(memoryPresent => memoryPresent ? [...base, window('soft')] : base);
      expect(withMemory.facts).toMatchObject({ temporalSoft: 1, temporalHard: 0 });
      expect(control.facts).toMatchObject({ temporalSoft: 0, temporalHard: 0 });
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, referenceCase)).not.toThrow();
    });

    it('accepts the recorded run-42450980679 shape: only the memory run read 「今週は」 as a hard end, and records it', async () => {
      const [withMemory, control] = await observe(memoryPresent => memoryPresent ? [...base, window('hard')] : base);
      expect(withMemory.hardConstraints).toEqual([{ kind: 'deadline', dateExpression: '2026-11-02/2026-11-08', statedInWords: true }]);
      expect(control.hardConstraints).toEqual([]);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, referenceCase)).not.toThrow();
      expect(describeReadingDifference(withMemory, control).hardConstraintsStatedInWords.withMemory).toHaveLength(1);
    });

    it('accepts a hard 今週 only the control read', async () => {
      const [withMemory, control] = await observe(memoryPresent => memoryPresent ? base : [...base, window('hard')]);
      expect(() => expectMemoryIsBackgroundOnly(withMemory, control, referenceCase)).not.toThrow();
    });

    // A hard constraint from a date the words do not state is strict, in either direction.
    const memoryDate = (dateExpression: string) => ({ ...window('hard'), dateExpression });
    it('fails when the memory run has a hard constraint on a date the words do not state, e.g. an exam day only the memory holds', async () => {
      const [added, control] = await observe(memoryPresent => memoryPresent ? [...base, memoryDate('2026-11-20')] : base);
      expect(added.hardConstraints).toEqual([{ kind: 'deadline', dateExpression: '2026-11-20', statedInWords: false }]);
      expect(() => expectMemoryIsBackgroundOnly(added, control, referenceCase)).toThrow();
      const [missing, had] = await observe(memoryPresent => memoryPresent ? base : [...base, memoryDate('2026-11-20')]);
      expect(() => expectMemoryIsBackgroundOnly(missing, had, referenceCase)).toThrow();
    });

    it('fails for a hard 今週 when the user\'s words do not contain it (the grounding is the words, not the expression)', async () => {
      const noWeek = MEMORY_CASES[2]; // 「数学は残り20分です」
      const items = [{ kind: 'task', localId: 't', category: 'study', title: '数学' },
        { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 20, unitCode: 'minute',
          unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
      const control = scripted(() => reading(items)); const withMemory = scripted(memoryPresent => reading(memoryPresent ? [...items, window('hard')] : items));
      const c = await observeMemoryTurn(control.ports, `${noWeek.id}-control`, noWeek.text, null, control);
      const m = await observeMemoryTurn(withMemory.ports, noWeek.id, noWeek.text, noWeek.records, withMemory);
      expect(m.hardConstraints).toEqual([{ kind: 'deadline', dateExpression: '2026-11-02/2026-11-08', statedInWords: false }]);
      expect(() => expectMemoryIsBackgroundOnly(m, c, noWeek)).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// #246 learning consultation: real model, synthetic conversation, one turn on a fresh conversation per scenario.
// Observed (recorded, never compared): what the native reading made of the words (empty delta or a task), whether the
// purpose check ran, what it decided, whether the advice passed its contract, and the advice text for a person to read.
// Judged automatically: an advice turn changes no fact, preview, question, approval or save; a plan or a greeting is
// never answered with advice. `246-summary.json` records how often the purpose call was added (a reading found nothing).
// ---------------------------------------------------------------------------------------------------------------------
const CONSULTATION_CASES = [
  { id: 'consult-english-weak', category: 'consultation', text: '英語が苦手なんだけど何から始めればいい？' },
  { id: 'consult-math-books', category: 'consultation', text: '数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？' },
  { id: 'consult-book-too-hard', category: 'consultation', text: 'この参考書が難しすぎるけど変えた方がいい？' },
  { id: 'consult-flow1', category: 'consultation', text: '英語の勉強法について相談したいです。計画はまだ作らず、アドバイスだけください。' },
  { id: 'plan-math-30', category: 'planning', text: '数学を30分' },
  // The first word of a plan is often only a task name; it must not be taken for a consultation (slice 2).
  { id: 'plan-first-math', category: 'planning', text: '数学をやりたい' },
  { id: 'plan-first-english', category: 'planning', text: '英語を頑張りたい' },
  { id: 'plan-create', category: 'planning', text: '予定を作って' },
  { id: 'greeting-thanks', category: 'greeting', text: 'ありがとう' },
  { id: 'greeting-hello', category: 'greeting', text: 'こんにちは' },
] as const;
type ConsultationCase = (typeof CONSULTATION_CASES)[number];

function observedConsultation(client: OpenAiCompatibleClient) {
  const inner = createWeeklyPlanningVNextConsultation(client);
  const log: { classifyCalled: boolean; classification: string | null; answerCalled: boolean; answer: { kind: string; text: string } | null } =
    { classifyCalled: false, classification: null, answerCalled: false, answer: null };
  const port: WeeklyPlanningVNextConsultationPort = {
    async classify(input) { log.classifyCalled = true; const kind = await inner.classify(input); log.classification = kind; return kind; },
    async answer(input) { log.answerCalled = true; const answer = await inner.answer(input); log.answer = answer; return answer; },
  };
  return { port, log };
}

async function observeConsultationTurn(scenario: ConsultationCase) {
  const h = createPorts();
  // A synthetic renderer buys no renderer calls and keeps the planning path's reply typed.
  h.ports.createRenderer = () => ({ render: async input => ({ status: 'rendered', text: `typed:${input.questionCode ?? input.actionKind}`, rawResponse: '' }) });
  const consultation = observedConsultation(h.ports.client);
  h.ports.consultation = consultation.port;
  const consultationScope = { ...scope, conversationId: `consultation-${scenario.id}` };
  const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope: consultationScope, ports: h.ports, turnId: 'consultation', userText: scenario.text, shownRevision: null });
  const read = readWeeklyPlanningVNextExperimentalSession(consultationScope, h.ports);
  const graph = read.status === 'ready' ? read.checkpoint.state.graph : null;
  const interpreted = turn.interpretation?.status === 'interpreted' ? turn.interpretation : null;
  const added = interpreted?.delta.add ?? [];
  return {
    scenario,
    native: { status: turn.interpretation?.status ?? null, planningIntent: interpreted?.planningIntent ?? null,
      deltaEmpty: interpreted ? added.length + interpreted.delta.patch.length + interpreted.delta.remove.length + interpreted.delta.relate.length + interpreted.delta.defer.length === 0 : null,
      // Only task names and their study context: no quantity, time, effort, date or relation (the reading the purpose check also covers).
      deltaDescriptionOnly: interpreted ? added.length > 0 && added.every(fact => fact.kind === 'task' || fact.kind === 'study_context') && interpreted.delta.patch.length + interpreted.delta.remove.length + interpreted.delta.relate.length + interpreted.delta.defer.length === 0 : null,
      taskTitles: added.flatMap(fact => fact.kind === 'task' ? [fact.title] : []) },
    purposeCheckRan: consultation.log.classifyCalled,
    classification: consultation.log.classification,
    answerCalled: consultation.log.answerCalled,
    answerContractPassed: consultation.log.answerCalled ? consultation.log.answer !== null : null,
    answerKind: consultation.log.answer?.kind ?? null,
    replySource: turn.replySource,
    adviceShown: turn.replySource === 'advice',
    // For a person: does the advice state anything the user did not say (their materials, scores, goals, schedule)?
    adviceText: turn.replySource === 'advice' ? turn.reply : null,
    state: { graphRevision: graph?.revision ?? null,
      tasks: graph ? filterActiveWeeklyPlanningFactsV5(graph, graph.tasks).length : null,
      workloads: graph ? filterActiveWeeklyPlanningFactsV5(graph, graph.workloads).length : null,
      efforts: graph ? filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates).length : null,
      temporal: graph ? filterActiveWeeklyPlanningFactsV5(graph, graph.temporalConstraints).length : null },
    previewShown: turn.preview !== null, drafts: turn.draftCandidates?.length ?? 0, questionCode: turn.question?.code ?? null,
    saves: h.saved.size, approvals: h.slots.has('ledger') ? 1 : 0, turn: snapshot(turn), raw: h.takeRawOutputs(),
  };
}

/** Typed oracle: an advice turn is harmless; only a consultation may be answered with advice. */
function expectConsultationOutcomeIsSafe(observed: Awaited<ReturnType<typeof observeConsultationTurn>>) {
  // Whatever the turn was: nothing was saved or approved by a consultation path.
  expect(observed.saves).toBe(0);
  expect(observed.approvals).toBe(0);
  if (observed.adviceShown) {
    expect(observed.scenario.category).toBe('consultation');
    expect(observed.classification).toBe('learning_consultation');
    expect(observed.state).toMatchObject({ graphRevision: 0, tasks: 0, workloads: 0, efforts: 0, temporal: 0 });
    expect(observed.previewShown).toBe(false);
    expect(observed.drafts).toBe(0);
    expect(observed.questionCode).toBeNull();
    // The reading held nothing but task names at most, and those names were dropped with the turn (the graph is untouched above).
    expect(observed.native.deltaEmpty === true || observed.native.deltaDescriptionOnly === true).toBe(true);
  } else {
    // The planning path is the old behavior, never a half-advice turn.
    expect(observed.replySource).not.toBe('advice');
  }
  if (observed.scenario.category !== 'consultation') {
    expect(observed.adviceShown).toBe(false);
    expect(observed.answerCalled).toBe(false);
  }
}

const consultationObservations: Array<Awaited<ReturnType<typeof observeConsultationTurn>>> = [];

function summarizeConsultation(observations: typeof consultationObservations) {
  const categories = [...new Set(observations.map(item => item.scenario.category))];
  const rate = (count: number, total: number) => (total === 0 ? null : Number((count / total).toFixed(3)));
  return {
    turns: observations.length,
    // The purpose call is added only when the native reading found nothing to plan: this is that share of all turns.
    purposeCheckRate: rate(observations.filter(item => item.purposeCheckRan).length, observations.length),
    byCategory: Object.fromEntries(categories.map(category => {
      const items = observations.filter(item => item.scenario.category === category);
      return [category, { turns: items.length,
        nativeDeltaEmpty: items.filter(item => item.native.deltaEmpty === true).length,
        nativeDescriptionOnly: items.filter(item => item.native.deltaDescriptionOnly === true).length,
        nativeTaskAdded: items.filter(item => item.native.taskTitles.length > 0).length,
        purposeCheckRan: items.filter(item => item.purposeCheckRan).length,
        classifiedConsultation: items.filter(item => item.classification === 'learning_consultation').length,
        answerContractPassed: items.filter(item => item.answerContractPassed === true).length,
        answerContractRefused: items.filter(item => item.answerContractPassed === false).length,
        adviceShown: items.filter(item => item.adviceShown).length }];
    })),
    perScenario: observations.map(item => ({ id: item.scenario.id, planningIntent: item.native.planningIntent, deltaEmpty: item.native.deltaEmpty, deltaDescriptionOnly: item.native.deltaDescriptionOnly,
      taskTitles: item.native.taskTitles, purposeCheckRan: item.purposeCheckRan, classification: item.classification, answerKind: item.answerKind,
      answerContractPassed: item.answerContractPassed, adviceShown: item.adviceShown, replySource: item.replySource })),
  };
}

run('#246 learning consultation is answered with advice, and only a consultation', () => {
  afterAll(() => {
    if (consultationObservations.length === 0) return;
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/246-summary.json`, `${JSON.stringify(summarizeConsultation(consultationObservations), null, 2)}\n`);
  });
  it.each(CONSULTATION_CASES)('$id', async scenario => {
    const artifact: Record<string, unknown> = { scenario, syntheticOnly: true, completed: false };
    try {
      const observed = await observeConsultationTurn(scenario);
      consultationObservations.push(observed);
      Object.assign(artifact, observed, { reviewNote: 'adviceText is for a person: it must not state facts about the user\'s materials, scores, goals or schedule that the words did not say.' });
      expectConsultationOutcomeIsSafe(observed);
      artifact.completed = true;
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(`${outputDir}/246-${scenario.id}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
    }
  }, Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? 420_000));
});

// Offline: the oracle and the summary against hand-made observations, so a broken oracle cannot pass the paid run unnoticed.
describe('#246 consultation observation oracle (no API)', () => {
  const base = (scenario: ConsultationCase, overrides: Partial<Awaited<ReturnType<typeof observeConsultationTurn>>> = {}) => ({
    scenario, native: { status: 'interpreted', planningIntent: 'unknown', deltaEmpty: true, deltaDescriptionOnly: false, taskTitles: [] as string[] }, purposeCheckRan: true,
    classification: 'learning_consultation', answerCalled: true, answerContractPassed: true, answerKind: 'proposal', replySource: 'advice', adviceShown: true,
    adviceText: '助言', state: { graphRevision: 0, tasks: 0, workloads: 0, efforts: 0, temporal: 0 }, previewShown: false, drafts: 0, questionCode: null,
    saves: 0, approvals: 0, turn: {}, raw: [], ...overrides }) as unknown as Awaited<ReturnType<typeof observeConsultationTurn>>;
  const byId = (id: string) => CONSULTATION_CASES.find(item => item.id === id)!;
  const consult = byId('consult-english-weak'); const greeting = byId('greeting-hello'); const planning = byId('plan-math-30'); const firstWord = byId('plan-first-math');

  it('passes a harmless advice turn, a refused advice that fell back to planning, and a planning turn', () => {
    expect(() => expectConsultationOutcomeIsSafe(base(consult))).not.toThrow();
    expect(() => expectConsultationOutcomeIsSafe(base(consult, { adviceShown: false, replySource: 'renderer', answerContractPassed: false, adviceText: null,
      state: { graphRevision: 0, tasks: 0, workloads: 0, efforts: 0, temporal: 0 } }))).not.toThrow();
    expect(() => expectConsultationOutcomeIsSafe(base(planning, { adviceShown: false, replySource: 'renderer', purposeCheckRan: false, classification: null,
      answerCalled: false, answerContractPassed: null, adviceText: null, answerKind: null, native: { status: 'interpreted', planningIntent: 'discuss', deltaEmpty: false, deltaDescriptionOnly: false, taskTitles: ['数学'] } }))).not.toThrow();
    // A consultation whose reading only named a task: advice shown, the task name dropped with the turn.
    expect(() => expectConsultationOutcomeIsSafe(base(byId('consult-math-books'), { native: { status: 'interpreted', planningIntent: 'discuss', deltaEmpty: false, deltaDescriptionOnly: true, taskTitles: ['数学'] } }))).not.toThrow();
    // The first word of a plan (a task name): the purpose check ran and said it is planning, so the task stays.
    expect(() => expectConsultationOutcomeIsSafe(base(firstWord, { adviceShown: false, replySource: 'renderer', classification: 'planning_operation', answerCalled: false, answerContractPassed: null, adviceText: null, answerKind: null,
      native: { status: 'interpreted', planningIntent: 'discuss', deltaEmpty: false, deltaDescriptionOnly: true, taskTitles: ['数学'] }, state: { graphRevision: 1, tasks: 1, workloads: 0, efforts: 0, temporal: 0 } }))).not.toThrow();
  });

  it.each([
    ['a fact changed on an advice turn', { state: { graphRevision: 1, tasks: 1, workloads: 0, efforts: 0, temporal: 0 } }],
    ['a preview was shown with advice', { previewShown: true }],
    ['a draft was made with advice', { drafts: 1 }],
    ['a question was asked with advice', { questionCode: 'missing_schedulable_work' }],
    ['a save happened', { saves: 1 }],
    ['an approval happened', { approvals: 1 }],
    ['advice followed a reading that held a quantity or time as well', { native: { status: 'interpreted', planningIntent: 'unknown', deltaEmpty: false, deltaDescriptionOnly: false, taskTitles: ['英語'] } }],
    ['advice with a task name that stayed in the graph', { state: { graphRevision: 1, tasks: 1, workloads: 0, efforts: 0, temporal: 0 }, native: { status: 'interpreted', planningIntent: 'unknown', deltaEmpty: false, deltaDescriptionOnly: true, taskTitles: ['数学'] } }],
    ['advice was shown without the consultation classification', { classification: 'unresolved' }],
  ])('fails when %s', (_name, overrides) => {
    expect(() => expectConsultationOutcomeIsSafe(base(consult, overrides as never))).toThrow();
  });

  it('fails when a greeting or a plan is answered with advice', () => {
    expect(() => expectConsultationOutcomeIsSafe(base(greeting))).toThrow();
    expect(() => expectConsultationOutcomeIsSafe(base(planning))).toThrow();
    // The first word of a plan taken for a consultation loses the task: the oracle must catch it.
    expect(() => expectConsultationOutcomeIsSafe(base(firstWord, { native: { status: 'interpreted', planningIntent: 'discuss', deltaEmpty: false, deltaDescriptionOnly: true, taskTitles: ['数学'] } }))).toThrow();
    expect(() => expectConsultationOutcomeIsSafe(base(greeting, { adviceShown: false, replySource: 'renderer', answerCalled: true }))).toThrow();
  });

  it('summarizes how often the purpose call was added and what each category did', () => {
    const summary = summarizeConsultation([base(consult), base(consult, { purposeCheckRan: false, adviceShown: false, answerCalled: false, answerContractPassed: null, classification: null }),
      base(greeting, { adviceShown: false, replySource: 'renderer', classification: 'unresolved', answerCalled: false, answerContractPassed: null }),
      base(planning, { purposeCheckRan: false, adviceShown: false, replySource: 'renderer', classification: null, answerCalled: false, answerContractPassed: null })]);
    expect(summary.turns).toBe(4);
    expect(summary.purposeCheckRate).toBe(0.5);
    expect(summary.byCategory.consultation).toMatchObject({ turns: 2, purposeCheckRan: 1, classifiedConsultation: 1, answerContractPassed: 1, adviceShown: 1 });
    expect(summary.byCategory.greeting).toMatchObject({ turns: 1, purposeCheckRan: 1, classifiedConsultation: 0, adviceShown: 0 });
    expect(summary.byCategory.planning).toMatchObject({ turns: 1, purposeCheckRan: 0 });
  });
});
