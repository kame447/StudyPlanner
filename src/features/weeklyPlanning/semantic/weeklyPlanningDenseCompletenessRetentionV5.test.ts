import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';

// Independent audit counterexample (ChatGPT read-only audit of ad1e7784; critic probe 23): a
// completeness re-read selected by the size-gated dense audit replaced the initial reading and
// silently dropped a captured task, while the same re-read was refused on short turns.
type Variant = { withoutWorkload?: string; deadlineOn?: string };
function document(titles: string[], architecture: WeeklyPlanningConversationArchitecture = 'interaction_v1', variant: Variant = {}): WeeklyPlanningSemanticDocumentV5 {
  const built = {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: titles.map((title, index) => ({
      localId: `task-${index}`, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title,
      study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: title, components: [] },
      workloads: [{ localId: `workload-${index}`, quantityRole: 'target', amount: 10, unitCode: 'problem', unitLabel: '問',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `${title}を10問` }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: `${title}を10問`,
    })),
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
    // Legacy responses carry no conversation acts.
    ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}),
  } as unknown as { tasks: Array<{ localId: string; title: string; workloads: unknown[]; temporalConstraints: unknown[] }> };
  for (const task of built.tasks) {
    if (task.title === variant.withoutWorkload) task.workloads = [];
    if (task.title === variant.deadlineOn) task.temporalConstraints = [{ localId: `deadline-${task.localId}`, targetLocalId: task.localId,
      kind: 'deadline', constraintLevel: 'hard', dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null,
      precision: 'exact', sourceText: '金曜までに' }];
  }
  return built as unknown as WeeklyPlanningSemanticDocumentV5;
}

const BASE = '来週、数学を10問進めたいです。物理を10問進めたいです。化学を10問も追加します。';
const FILLER = 'それぞれ自分のペースで、無理のない範囲で取り組みたいと思っています。';
const bytes = (text: string) => new TextEncoder().encode(text).length;
function textOfAtLeast(minimumBytes: number, base = BASE): string {
  let text = base;
  while (bytes(text) + bytes(FILLER) <= minimumBytes) text += FILLER;
  // Pad the last few bytes with ASCII spaces only for the exact 1199/1200 boundary cases.
  while (bytes(text) < minimumBytes) text += ' ';
  return text;
}

async function run(userText: string, reread: string[] | string[][], architecture: WeeklyPlanningConversationArchitecture,
  initial: string[] = ['数学', '物理'], variants: { initial?: Variant; reread?: Variant } = {}) {
  // A nested list scripts an invalid re-read followed by its single repair.
  const rereads = Array.isArray(reread[0]) ? ['{invalid-reread', ...(reread as string[][]).map(titles => JSON.stringify(document(titles, architecture, variants.reread)))]
    : [JSON.stringify(document(reread as string[], architecture, variants.reread))];
  const responses = [
    JSON.stringify(document(initial, architecture, variants.initial)),
    JSON.stringify({ decision: 'incomplete', missingFacts: ['化学を10問'] }),
    ...rereads,
  ];
  const calls: string[] = [];
  const normalizer = createWeeklyPlanningSemanticNormalizerV5({
    async createChatCompletion(request: { responseFormat?: { json_schema?: { name?: string } } }) {
      calls.push(request.responseFormat?.json_schema?.name ?? 'other');
      const next = responses.shift();
      if (next === undefined) throw new Error('unexpected extra dispatch');
      return next;
    },
  } as never);
  const result = await normalizer.normalize({ userText, conversationArchitecture: architecture } as never);
  return { result, calls, titles: result.document?.tasks.map(task => task.title) ?? [] };
}

describe('interaction completeness re-read retention on every audit route', () => {
  it.each([
    ['short turn', bytes(BASE)],
    ['just below the dense threshold', 1199],
    ['at the dense threshold', 1200],
    ['natural dense text', 1300],
  ] as const)('a lossy re-read keeps the valid initial reading: %s', async (_label, minimumBytes) => {
    const userText = textOfAtLeast(minimumBytes);
    expect(bytes(userText)).toBeGreaterThanOrEqual(minimumBytes);
    const { result, calls, titles } = await run(userText, ['数学', '化学'], 'interaction_v1');
    expect(result.status).toBe('accepted');
    expect(titles).toEqual(['数学', '物理']);
    expect((result as { completenessAbstention?: { reason: string } }).completenessAbstention)
      .toEqual({ reason: 'initial_facts_not_preserved' });
    expect(calls).toHaveLength(3);
  });

  it.each([['short', bytes(BASE)], ['dense', 1300]] as const)('the repair of an invalid re-read is held to the same floor: %s', async (_label, minimumBytes) => {
    const { result, calls, titles } = await run(textOfAtLeast(minimumBytes), [['数学', '化学']], 'interaction_v1');
    expect(result.status).toBe('accepted');
    expect(titles).toEqual(['数学', '物理']);
    expect((result as { completenessAbstention?: { reason: string } }).completenessAbstention)
      .toEqual({ reason: 'initial_facts_not_preserved' });
    // initial, audit, invalid re-read, its one repair: never a second repair.
    expect(calls).toHaveLength(4);
  });

  it('more captured targets: dropping any one of four is refused, adding the fifth is accepted', async () => {
    const four = ['数学', '物理', '英語', '国語'];
    const text = textOfAtLeast(1300, '来週、数学を10問、物理を10問、英語を10問、国語を10問進めたいです。化学を10問も追加します。');
    const dropped = await run(text, ['数学', '物理', '英語', '化学'], 'interaction_v1', four);
    expect(dropped.titles).toEqual(four);
    const added = await run(text, [...four, '化学'], 'interaction_v1', four);
    expect(added.titles).toEqual([...four, '化学']);
  });

  it('a dense re-read that keeps every task but drops a workload inside one is refused', async () => {
    const { result, titles } = await run(textOfAtLeast(1300), ['数学', '物理', '化学'], 'interaction_v1', ['数学', '物理'],
      { reread: { withoutWorkload: '物理' } });
    expect(titles).toEqual(['数学', '物理']);
    expect(result.document?.tasks.find(task => task.title === '物理')?.workloads).toHaveLength(1);
    expect((result as { completenessAbstention?: { reason: string } }).completenessAbstention?.reason).toBe('initial_facts_not_preserved');
  });

  it('a dense re-read that drops a temporal constraint is refused', async () => {
    const text = textOfAtLeast(1300, '来週、数学を10問、金曜までに進めたいです。物理を10問進めたいです。化学を10問も追加します。');
    const { result, titles } = await run(text, ['数学', '物理', '化学'], 'interaction_v1', ['数学', '物理'],
      { initial: { deadlineOn: '数学' } });
    expect(titles).toEqual(['数学', '物理']);
    expect(result.document?.tasks.find(task => task.title === '数学')?.temporalConstraints).toHaveLength(1);
    expect((result as { completenessAbstention?: { reason: string } }).completenessAbstention?.reason).toBe('initial_facts_not_preserved');
  });

  it('five captured targets: dropping one is refused', async () => {
    const five = ['数学', '物理', '英語', '国語', '社会'];
    const text = textOfAtLeast(1300, '来週、数学を10問、物理を10問、英語を10問、国語を10問、社会を10問進めたいです。化学を10問も追加します。');
    const dropped = await run(text, ['数学', '物理', '英語', '国語', '化学'], 'interaction_v1', five);
    expect(dropped.titles).toEqual(five);
  });

  it('the floor is only this turn\'s first reading: a turn that states less than an earlier turn is not blocked', async () => {
    // Each normalize run is one turn; a later turn's smaller reading is its own floor, so an
    // explicit later reduction or correction is never held to an earlier turn's facts.
    const text = textOfAtLeast(1300, '来週は数学を10問だけにします。化学を10問も追加します。');
    const { result, titles } = await run(text, ['数学', '化学'], 'interaction_v1', ['数学']);
    expect(titles).toEqual(['数学', '化学']);
    expect((result as { completenessAbstention?: unknown }).completenessAbstention).toBeUndefined();
  });

  it('an additive dense re-read is accepted (the floor never blocks added meaning)', async () => {
    const { result, calls, titles } = await run(textOfAtLeast(1300), ['数学', '物理', '化学'], 'interaction_v1');
    expect(result.status).toBe('accepted');
    expect(titles).toEqual(['数学', '物理', '化学']);
    expect(calls).toHaveLength(3);
  });

  it('legacy dense re-read behavior is unchanged (documented residual: the re-read replaces the reading)', async () => {
    const { result, calls, titles } = await run(textOfAtLeast(1300), ['数学', '化学'], 'legacy_v5');
    expect(result.status).toBe('accepted');
    expect(titles).toEqual(['数学', '化学']);
    expect(calls).toHaveLength(3);
  });
});

describe('an omission the turn could not check or take in is disclosed, never silent (interaction)', () => {
  // Short literal-gap route: 数学 is read, the rest of the turn is not cited (gap >= 8) and no
  // effort is known, so the existing coverage audit is selected.
  const SHORT = '来週、数学を10問進めたいです。化学も少しやりたいと思っています。';
  async function runWith(architecture: WeeklyPlanningConversationArchitecture, behave: (kind: string, index: number) => string) {
    const calls: string[] = [];
    const normalizer = createWeeklyPlanningSemanticNormalizerV5({
      async createChatCompletion(request: { responseFormat?: { json_schema?: { name?: string } } }) {
        const kind = request.responseFormat?.json_schema?.name ?? 'other';
        calls.push(kind);
        return behave(kind, calls.length);
      },
    } as never);
    const result = await normalizer.normalize({ userText: SHORT, conversationArchitecture: architecture } as never);
    return { result: result as typeof result & { completenessAbstention?: { reason: string; step?: string } }, calls };
  }
  const doc = (architecture: WeeklyPlanningConversationArchitecture) => JSON.stringify(document(['数学'], architecture));
  const AUDIT = 'weekly_planning_dense_turn_completeness_audit_v5';

  it.each([
    ['a malformed audit', 'malformed_audit_response', 'audit', (kind: string, index: number) => (kind === AUDIT ? '{"decision":"maybe"}' : index === 1 ? 'DOC' : '')],
    ['an audit outage', 'provider_failure', 'audit', (kind: string, index: number) => { if (kind === AUDIT) throw new Error('audit outage'); return index === 1 ? 'DOC' : ''; }],
    ['a re-read outage after an incomplete audit', 'provider_failure', 'retry', (kind: string, index: number) => {
      if (kind === AUDIT) return JSON.stringify({ decision: 'incomplete', missingFacts: ['化学'] });
      if (index === 1) return 'DOC';
      throw new Error('re-read outage');
    }],
  ] as const)('%s keeps the first reading and records the disclosure signal', async (_label, reason, step, behave) => {
    const { result } = await runWith('interaction_v1', (kind, index) => {
      const value = behave(kind, index);
      return value === 'DOC' ? doc('interaction_v1') : value;
    });
    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map(task => task.title)).toEqual(['数学']);
    expect(result.completenessAbstention).toEqual({ reason, step });
  });

  it('legacy keeps its silent retention (documented residual)', async () => {
    const { result } = await runWith('legacy_v5', (kind, index) => (kind === AUDIT ? '{"decision":"maybe"}' : index === 1 ? doc('legacy_v5') : ''));
    expect(result.status).toBe('accepted');
    expect(result.completenessAbstention).toBeUndefined();
  });
});

describe('a reported omission that the accepted re-read did not take in is disclosed (critic probe 24)', () => {
  type Abstention = { completenessAbstention?: { reason: string; step?: string } };
  it.each([['short', bytes(BASE)], ['dense', 1300]] as const)('a valid re-read that adds nothing: %s', async (_label, minimumBytes) => {
    const { result, titles, calls } = await run(textOfAtLeast(minimumBytes), ['数学', '物理'], 'interaction_v1');
    expect(result.status).toBe('accepted');
    expect(titles).toEqual(['数学', '物理']);
    expect((result as Abstention).completenessAbstention).toEqual({ reason: 'omission_not_taken_in', step: 'retry' });
    expect(calls).toHaveLength(3);
  });

  it('a repaired re-read that adds nothing is disclosed the same way', async () => {
    const { result, titles } = await run(textOfAtLeast(1300), [['数学', '物理']], 'interaction_v1');
    expect(titles).toEqual(['数学', '物理']);
    expect((result as Abstention).completenessAbstention).toEqual({ reason: 'omission_not_taken_in', step: 'retry' });
  });

  it('a re-read that takes the omission in carries no disclosure', async () => {
    const { result, titles } = await run(textOfAtLeast(1300), ['数学', '物理', '化学'], 'interaction_v1');
    expect(titles).toEqual(['数学', '物理', '化学']);
    expect((result as Abstention).completenessAbstention).toBeUndefined();
  });

  it('legacy is unchanged: no disclosure signal', async () => {
    const { result } = await run(textOfAtLeast(1300), ['数学', '物理'], 'legacy_v5');
    expect((result as Abstention).completenessAbstention).toBeUndefined();
  });
});
