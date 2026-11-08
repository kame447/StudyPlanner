// Stored advice, its adoption and its withdrawal in the VNext session (#246 slice 3). The consultation port is scripted;
// nothing here calls a provider. Advice stays advice: no fact, preview, plan or save comes from storing or adopting it.
import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { ProposalAnswer } from '../../consultation/contracts';
import { CONSULTATION_MAX_PROPOSALS, CONSULTATION_MAX_PROPOSAL_BYTES } from '../../consultation/persistence';
import type { UserPlanningContextRecordV1 } from '../../../userPlanningContext/userPlanningContextTypes';
import { selectVNextConfirmedUserContext } from '../weeklyPlanningVNextConfirmedUserContext';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import type { WeeklyPlanningVNextConsultationPort } from './weeklyPlanningVNextConsultation';
import { projectWeeklyPlanningVNextAdvice, reviewWeeklyPlanningVNextAdvice, withdrawWeeklyPlanningVNextAdviceForRecords } from './weeklyPlanningVNextAdvice';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'owner-1', weekStartDate: '2026-11-02', conversationId: 'conversation-246',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};
const metrics = { calls: 1, repairs: 0, latencyMs: 1 };
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (planningIntent: 'discuss' | 'unknown' | 'create_plan', delta: Partial<VNextTurnDelta> = {}): WeeklyPlanningVNextInterpretation =>
  ({ status: 'interpreted', planningIntent, delta: { ...EMPTY, ...delta }, answer: null, metrics });
const task: VNextAddFact = { kind: 'task', localId: 'eng', category: 'study', title: '英語' };

const proposal = (text = '文法の基礎問題集を毎日1ページ。', optionTitles = ['毎日少しずつ']): ProposalAnswer => ({
  schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal', userFacingAnswer: text, assumptions: [], overallUncertainty: 'low',
  options: optionTitles.map(title => ({ title, strategySummary: '短く続ける', tradeoffs: [], recommendations: [{ recommendationKind: 'study_method',
    rationale: '続けやすい', assumptionRefs: [], evidenceRefs: [], uncertainty: 'low' as const }] })) });
const memory = (id: string, label: string): UserPlanningContextRecordV1 => ({ id, ownerId: scope.ownerId, kind: 'study_goal', label, value: '合格が目標',
  dateExpression: null, observedDate: '2026-10-01', resolvedDate: null, sourceText: `ORIGINAL-${id}`, sourceConversationId: 'earlier', sourceTurnId: 'earlier-turn',
  recordedAt: '2026-10-01T00:00:00.000Z', status: 'active', origin: 'user_confirmed' });

function harness(script: WeeklyPlanningVNextInterpretation[], answers: Array<{ kind: 'proposal'; proposal: ProposalAnswer } | { kind: 'clarification' }> = []) {
  const slots = new Map<string, string>();
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const saveBlock = vi.fn(async () => { throw new Error('advice never saves'); });
  let tick = 0;
  const consultation: WeeklyPlanningVNextConsultationPort = {
    classify: async () => 'learning_consultation',
    answer: async () => {
      const next = answers.shift() ?? { kind: 'proposal' as const, proposal: proposal() };
      return next.kind === 'proposal' ? { kind: 'proposal', text: `${next.proposal.userFacingAnswer}\n\n※これは助言です。`, proposal: next.proposal }
        : { kind: 'clarification', text: 'どの教科ですか？' };
    },
  };
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: {} as OpenAiCompatibleClient,
    async interpret() { const next = script.shift(); if (!next) throw new Error('script exhausted'); return next; },
    checkpoint: slot('vnext'), legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('ledger'),
    plans: { async findExistingPlanId() { return undefined; }, saveBlock },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: () => ({ async render(input) { return { status: 'rendered', text: `（${input.actionKind}）`, rawResponse: '' }; } }),
    consultation, now: () => new Date(Date.UTC(2026, 10, 2, 9, 0, tick++)).toISOString(),
  };
  const turn = (userText: string, records?: UserPlanningContextRecordV1[]) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `t${tick}`, userText,
    shownRevision: null, ...(records ? { confirmedUserContext: selectVNextConfirmedUserContext({ ownerId: scope.ownerId, records, relevantScopeKeys: [] })! } : {}) });
  const checkpoint = () => parseWeeklyPlanningVNextSessionCheckpoint({ raw: slots.get('vnext')!, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })!;
  const consult = () => checkpoint().vnext.consultation;
  const review = (request: Partial<Parameters<typeof reviewWeeklyPlanningVNextAdvice>[2]> = {}) => {
    const view = projectWeeklyPlanningVNextAdvice(consult())!;
    return reviewWeeklyPlanningVNextAdvice(scope, ports, { adviceId: view.adviceId, adviceRevision: view.adviceRevision,
      consultationRevision: view.consultationRevision, action: 'approve', ...request });
  };
  return { ports, slots, saveBlock, turn, checkpoint, consult, review };
}

describe('advice is kept for the user to adopt or decline (#246 slice 3)', () => {
  it('stores a proposal as reviewable advice, with the ids (never the words) of the memory it was written from', async () => {
    const h = harness([reading('discuss')]);
    await h.turn('英語が苦手なんだけど何から始めればいい？', [memory('goal-1', '志望校'), memory('goal-2', '得意科目')]);
    const consultation = h.consult()!;
    expect(consultation.proposals).toHaveLength(1);
    expect([...consultation.proposals[0].derivedFromRecordIds!].sort()).toEqual(['goal-1', 'goal-2']);
    expect(JSON.stringify(consultation)).not.toContain('ORIGINAL-goal-1');
    expect(consultation.proposals[0].answer.userFacingAnswer).not.toContain('※これは助言です');
    expect(projectWeeklyPlanningVNextAdvice(consultation)).toMatchObject({ status: 'reviewable', optionTitles: ['毎日少しずつ'] });
    // Advice is never a fact, a preview or a save.
    const stored = h.checkpoint().vnext;
    expect([stored.state.graph.tasks, stored.state.graph.workloads, stored.preview]).toEqual([[], [], null]);
    expect(h.saveBlock).not.toHaveBeenCalled();
  });

  it('keeps nothing for a clarification, and a memory-free proposal carries no derived ids', async () => {
    const h = harness([reading('discuss'), reading('discuss')], [{ kind: 'clarification' }]);
    await h.turn('何から始めればいい？');
    expect(h.consult()).toBeUndefined();
    await h.turn('英語です');
    expect(h.consult()!.proposals[0].derivedFromRecordIds).toBeUndefined();
  });

  it('shows a proposal over the size bound as text only and closes the earlier advice, so only what is shown can be adopted', async () => {
    const h = harness([reading('discuss'), reading('discuss')], [{ kind: 'proposal', proposal: proposal() },
      { kind: 'proposal', proposal: proposal('あ'.repeat(CONSULTATION_MAX_PROPOSAL_BYTES)) }]);
    await h.turn('英語は何から？');
    expect(projectWeeklyPlanningVNextAdvice(h.consult())?.status).toBe('reviewable');
    const second = await h.turn('数学は何から？');
    expect(second).toMatchObject({ outcome: 'noop', replySource: 'advice' });
    expect(second.reply).toContain('あ'.repeat(100));
    expect(h.consult()).toMatchObject({ lifecycle: 'closed', activeAdviceId: null });
    expect(projectWeeklyPlanningVNextAdvice(h.consult())).toBeNull();
    expect(h.checkpoint().vnext.messages.slice(-1)[0].content).toContain('あ'.repeat(100));
  });

  it('a newer proposal supersedes the active one, and the history is bounded, reading back after every turn', async () => {
    const h = harness(Array.from({ length: CONSULTATION_MAX_PROPOSALS + 2 }, () => reading('discuss')));
    for (let index = 0; index <= CONSULTATION_MAX_PROPOSALS + 1; index += 1) {
      await h.turn(`相談${index}`);
      expect(h.consult()).toBeDefined(); // the checkpoint still reads back
    }
    const consultation = h.consult()!;
    expect(consultation.proposals).toHaveLength(CONSULTATION_MAX_PROPOSALS);
    expect(consultation.proposals[0].supersedes).toBeNull();
    expect(consultation.proposals.slice(0, -1).every(p => p.supersededBy !== null)).toBe(true);
    expect(projectWeeklyPlanningVNextAdvice(consultation)).toMatchObject({ status: 'reviewable' });
  });
});

describe('adopting or declining is one recorded decision on the active advice', () => {
  it('records the adoption once, stores no fact or plan, and survives reload', async () => {
    const h = harness([reading('discuss')]);
    await h.turn('何から始めればいい？');
    const before = h.checkpoint().vnext;
    expect(h.review()).toMatchObject({ status: 'reviewed' });
    const after = h.checkpoint().vnext;
    expect(after.consultation!.reviewDecisions).toHaveLength(1);
    expect(after.consultation!.reviewDecisions[0]).toMatchObject({ action: 'approve', targetScope: { kind: 'proposal' }, feedback: null });
    expect([after.state, after.preview, after.messages]).toEqual([before.state, before.preview, before.messages]);
    expect(projectWeeklyPlanningVNextAdvice(after.consultation)).toMatchObject({ status: 'approved' });
    expect(h.saveBlock).not.toHaveBeenCalled();
    // A second adoption of the same advice, even a double click, changes nothing.
    const raw = h.slots.get('vnext');
    expect(h.review()).toEqual({ status: 'rejected', reason: 'review_already_consumed' });
    expect(h.slots.get('vnext')).toBe(raw);
  });

  it('adopts one option, and refuses an option that does not exist or a review of a revision the user was not shown', async () => {
    const h = harness([reading('discuss')], [{ kind: 'proposal', proposal: proposal('二つの案があります。', ['毎日少しずつ', '週末にまとめて']) }]);
    await h.turn('何から始めればいい？');
    const raw = h.slots.get('vnext');
    expect(h.review({ optionIndex: 5 })).toMatchObject({ status: 'rejected', reason: 'invalid_review_scope' });
    expect(h.review({ consultationRevision: 99 })).toMatchObject({ status: 'rejected', reason: 'stale_consultation_revision' });
    expect(h.review({ adviceRevision: 9 })).toMatchObject({ status: 'rejected', reason: 'not_active_advice_leaf' });
    expect(h.slots.get('vnext')).toBe(raw);
    expect(h.review({ optionIndex: 1 })).toMatchObject({ status: 'reviewed' });
    expect(h.consult()!.reviewDecisions[0].targetScope).toEqual({ kind: 'option', optionIndex: 1 });
  });

  it('a stale screen cannot adopt advice that a newer one replaced', async () => {
    const h = harness([reading('discuss'), reading('discuss')]);
    await h.turn('英語は何から？');
    const shown = projectWeeklyPlanningVNextAdvice(h.consult())!;
    await h.turn('数学は何から？');
    const result = reviewWeeklyPlanningVNextAdvice(scope, h.ports, { adviceId: shown.adviceId, adviceRevision: shown.adviceRevision,
      consultationRevision: shown.consultationRevision, action: 'approve' });
    expect(result.status).toBe('rejected');
    expect(h.consult()!.reviewDecisions).toEqual([]);
  });

  it('declining closes the consultation, and the next advice starts a fresh one', async () => {
    const h = harness([reading('discuss'), reading('discuss')]);
    await h.turn('英語は何から？');
    expect(h.review({ action: 'dismiss' })).toMatchObject({ status: 'reviewed' });
    expect(h.consult()).toMatchObject({ lifecycle: 'closed' });
    expect(projectWeeklyPlanningVNextAdvice(h.consult())).toBeNull();
    const closedId = h.consult()!.consultationId;
    await h.turn('数学は何から？');
    expect(h.consult()).toMatchObject({ lifecycle: 'active' });
    expect(h.consult()!.consultationId).not.toBe(closedId);
    expect(projectWeeklyPlanningVNextAdvice(h.consult())?.status).toBe('reviewable');
  });

  it('refuses a review of another conversation or an unreadable checkpoint without writing', async () => {
    const h = harness([reading('discuss')]);
    await h.turn('何から始めればいい？');
    const view = projectWeeklyPlanningVNextAdvice(h.consult())!;
    const request = { adviceId: view.adviceId, adviceRevision: view.adviceRevision, consultationRevision: view.consultationRevision, action: 'approve' as const };
    const raw = h.slots.get('vnext');
    expect(reviewWeeklyPlanningVNextAdvice({ ...scope, conversationId: 'other' }, h.ports, request)).toEqual({ status: 'unreadable' });
    h.slots.set('vnext', 'not json');
    expect(reviewWeeklyPlanningVNextAdvice(scope, h.ports, request)).toEqual({ status: 'unreadable' });
    h.slots.set('vnext', raw!);
    expect(reviewWeeklyPlanningVNextAdvice(scope, h.ports, request)).toMatchObject({ status: 'reviewed' });
  });
});

describe('a planning turn after the advice keeps it (F3)', () => {
  it('carries the saved advice and its adoption through an ordinary planning turn', async () => {
    const h = harness([reading('discuss'), reading('discuss', { add: [task] })]);
    await h.turn('何から始めればいい？');
    expect(h.review()).toMatchObject({ status: 'reviewed' });
    const before = h.consult();
    const planning = await h.turn('英語を始めたい');
    expect(planning).toMatchObject({ outcome: 'applied', replySource: 'renderer' });
    expect(h.checkpoint().vnext.state.graph.tasks).toHaveLength(1);
    expect(h.consult()).toEqual(before);
    expect(projectWeeklyPlanningVNextAdvice(h.consult())).toMatchObject({ status: 'approved' });
  });

  it('carries unadopted advice through a planning turn and still lets the user adopt it', async () => {
    const h = harness([reading('discuss'), reading('discuss', { add: [task] })]);
    await h.turn('何から始めればいい？');
    await h.turn('英語を始めたい');
    expect(projectWeeklyPlanningVNextAdvice(h.consult())?.status).toBe('reviewable');
    expect(h.review()).toMatchObject({ status: 'reviewed' });
  });
});

describe('a forgotten memory withdraws the advice written from it', () => {
  it('removes the words of that proposal only, keeps its identity and decision, and makes it unadoptable', async () => {
    const h = harness([reading('discuss'), reading('discuss')], [{ kind: 'proposal', proposal: proposal('志望校向けの助言です。', ['志望校案']) },
      { kind: 'proposal', proposal: proposal('英語の助言です。', ['英語案']) }]);
    await h.turn('志望校に向けて何から？', [memory('goal-1', '志望校')]);
    const decided = h.review();
    expect(decided.status).toBe('reviewed');
    await h.turn('英語は何から？'); // written with no memory
    const before = h.consult()!;
    const first = before.proposals[0];
    expect(withdrawWeeklyPlanningVNextAdviceForRecords(scope, h.ports, new Set(['goal-1']))).toBe(true);
    const after = h.consult()!;
    expect(after.proposals[0]).toMatchObject({ adviceId: first.adviceId, withdrawnAt: expect.any(String) });
    expect(after.proposals[0].answer.userFacingAnswer).not.toBe(first.answer.userFacingAnswer);
    expect(after.reviewDecisions).toEqual(before.reviewDecisions);
    expect(after.proposals[1]).toEqual(before.proposals[1]);
    expect(JSON.stringify(after)).not.toContain('志望校向けの助言です。');
    expect(JSON.stringify(after)).not.toContain('志望校案');
    expect(JSON.stringify(after)).toContain('英語案');
    // Nothing else is asked again: a second withdrawal of the same record is a no-op.
    const raw = h.slots.get('vnext');
    expect(withdrawWeeklyPlanningVNextAdviceForRecords(scope, h.ports, new Set(['goal-1']))).toBe(false);
    expect(h.slots.get('vnext')).toBe(raw);
  });

  it('a withdrawn active advice is shown as withdrawn and cannot be adopted', async () => {
    const h = harness([reading('discuss')]);
    await h.turn('志望校に向けて何から？', [memory('goal-1', '志望校')]);
    const view = projectWeeklyPlanningVNextAdvice(h.consult())!;
    expect(withdrawWeeklyPlanningVNextAdviceForRecords(scope, h.ports, new Set(['goal-1']))).toBe(true);
    expect(projectWeeklyPlanningVNextAdvice(h.consult())).toMatchObject({ status: 'withdrawn', optionTitles: [] });
    const raw = h.slots.get('vnext');
    const result = reviewWeeklyPlanningVNextAdvice(scope, h.ports, { adviceId: view.adviceId, adviceRevision: view.adviceRevision,
      consultationRevision: h.consult()!.revision, action: 'approve' });
    expect(result).toEqual({ status: 'rejected', reason: 'advice_withdrawn' });
    expect(h.slots.get('vnext')).toBe(raw);
  });

  it('leaves advice written from other memory, or none, untouched', async () => {
    const h = harness([reading('discuss')]);
    await h.turn('何から？', [memory('goal-2', '得意科目')]);
    const raw = h.slots.get('vnext');
    expect(withdrawWeeklyPlanningVNextAdviceForRecords(scope, h.ports, new Set(['goal-1']))).toBe(false);
    expect(withdrawWeeklyPlanningVNextAdviceForRecords(scope, h.ports, new Set())).toBe(false);
    expect(h.slots.get('vnext')).toBe(raw);
  });
});
