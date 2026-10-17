import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './weeklyPlanningSemanticPromptAssemblyV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { selectReplyReferenceHintV5, type ReplyReferenceChoiceCalibrationV5 } from './weeklyPlanningReplyReferenceChoiceV5';
import {
  createReplyReferenceSnapshotV5, extractReplyReferenceEvidenceV5,
  resolveReplyReferenceCandidateV5,
} from './weeklyPlanningReplyReferenceCandidatesV5';

const source = (turnId: string) => ({
  conversationId: 'c', turnId, semanticLocalId: 'local', sourceText: 'ユーザーの入力', origin: 'user' as const,
});
const messages: WeeklyPlanningMessage[] = [
  { id: 'c:turn:1:user', role: 'user', content: '数学をやりたい', createdAt: '2026-10-17T00:00:00Z' },
  { id: 'c:turn:2:user', role: 'user', content: '青チャートの微積分を20問', createdAt: '2026-10-17T00:01:00Z' },
  { id: 'c:turn:3:assistant', role: 'assistant', content: '1問あたりの時間は？', createdAt: '2026-10-17T00:02:00Z' },
];
function fixture() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 3;
  graph.tasks.push({ id: 'task', title: '数学', category: 'study', source: source('c:request:1'), createdRevision: 1 });
  graph.components.push(
    { id: 'material', taskId: 'task', parentComponentId: null, label: '青チャート',
      role: 'material', source: source('c:request:2'), createdRevision: 2 },
    { id: 'topic', taskId: 'task', parentComponentId: 'material', label: '微積分',
      role: 'topic', source: source('c:request:2'), createdRevision: 2 },
  );
  graph.workloads.push({ id: 'work', taskId: 'task', componentId: 'topic', quantityRole: 'target',
    amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, source: source('c:request:2'), createdRevision: 3 });
  graph.factLifecycles = [...graph.tasks, ...graph.components, ...graph.workloads].map(fact => ({
    factId: fact.id, status: 'active' as const,
    createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null,
  }));
  return graph;
}
function question(): PlanningIntakeState {
  return { lastQuestionContext: {
    kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work', intent: 'duration_per_unit',
    presentation: {
      version: 1, turnId: 'c:turn:3', assistantMessageId: 'c:turn:3:assistant',
      planningStateRevision: 7, graphRevision: 3,
      content: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none',
        selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 },
        previewPromotionControl: false },
    },
  } } as PlanningIntakeState;
}
describe('bounded historical reply-reference candidates', () => {
  it('binds a reply to a real message, full task ancestry and typed slot without extracting values', () => {
    const input = { graph: fixture(), messages, previousState: question(), inputStateRevision: 7, conversationId: 'c' };
    const snapshot = createReplyReferenceSnapshotV5(input)!;
    expect(snapshot.dialogueHistory).toEqual([
      { messageOrdinal: 1, role: 'user', content: '数学をやりたい' },
      { messageOrdinal: 2, role: 'user', content: '青チャートの微積分を20問' },
      { messageOrdinal: 3, role: 'assistant', content: '1問あたりの時間は？' },
    ]);
    const amount = snapshot.candidates.find(item => item.sourceMessageId === 'c:turn:2:user'
      && item.targetFactId === 'work' && item.slot === 'quantity')!;
    expect(amount).toMatchObject({ targetKind: 'workload', taskFactId: 'task',
      componentPath: ['青チャート', '微積分'], operation: 'set_value' });
    expect(snapshot.candidates.some(item => item.sourceMessageId === 'c:turn:3:assistant'
      && item.targetFactId === 'work' && item.slot === 'duration_per_unit')).toBe(true);
    const pending = snapshot.candidates.filter(item => item.sourceMessageId === 'c:turn:3:assistant');
    expect(pending.map(item => item.slot)).toEqual(['duration_per_unit']);
    expect(snapshot.candidates.filter(item => item.targetFactId === 'work' && item.slot === 'duration_per_unit'))
      .toHaveLength(1);
    expect(snapshot.pendingQuestion).toEqual({ messageOrdinal: 3,
      questionCode: 'stable_v5:missing_effort_estimate', candidateKeys: pending.map(item => item.key) });
    expect(resolveReplyReferenceCandidateV5(snapshot, amount.key, input)).toEqual(amount);
    expect(resolveReplyReferenceCandidateV5(snapshot, 'missing', input)).toBeNull();
  });

  it('never turns a changed graph, stale question or old message into an authoritative anchor', () => {
    const graph = fixture();
    const current = { graph, messages, previousState: question(), inputStateRevision: 7, conversationId: 'c' };
    const snapshot = createReplyReferenceSnapshotV5(current)!;
    const updated = structuredClone(graph);
    updated.revision += 1;
    expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, {
      ...current, graph: updated,
    })).toBeNull();
    // A transcript edit with stable message IDs must also invalidate the model's choice.
    const rewritten = messages.map(message => message.id === 'c:turn:3:assistant'
      ? { ...message, content: '今日は掃除の時間を決めましょう' } : message);
    expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, {
      ...current, messages: rewritten,
    })).toBeNull();
    const stale = createReplyReferenceSnapshotV5({
      ...current, inputStateRevision: 8,
    })!;
    expect(stale.candidates.every(candidate => candidate.sourceMessageId !== 'c:turn:3:assistant')).toBe(true);
    const removed = structuredClone(graph);
    removed.factLifecycles = [
      ...[...removed.tasks, ...removed.components].map(fact => ({
        factId: fact.id, status: 'active' as const,
        createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null,
      })),
      { factId: 'work', status: 'removed' as const, createdRevision: 3,
        terminalRevision: 4, supersededByFactId: null },
    ];
    expect(createReplyReferenceSnapshotV5({ ...current, graph: removed })?.candidates
      .some(item => item.targetFactId === 'work')).toBe(false);
  });

  it('rejects an active fact imported from another conversation', () => {
    expect(createReplyReferenceSnapshotV5({
      graph: fixture(), messages, inputStateRevision: 7, conversationId: 'other-conversation',
    })).toBeNull();
    expect(createReplyReferenceSnapshotV5({
      graph: fixture(), messages, inputStateRevision: 7, conversationId: 'c',
    })).not.toBeNull();
  });

  it('requires the question-time measurement and preserves nested session-duration answers', () => {
    const state = question();
    state.lastQuestionContext!.intent = 'session_duration';
    const input = { graph: fixture(), messages, previousState: state, inputStateRevision: 7, conversationId: 'c' };
    const snapshot = createReplyReferenceSnapshotV5(input)!;
    expect(snapshot.candidates.filter(item => item.sourceMessageId === 'c:turn:3:assistant'))
      .toEqual([expect.objectContaining({ slot: 'session_duration', targetFactId: 'work',
        componentPath: ['青チャート', '微積分'] })]);
    // The typed question must not be recomputed from workload labels/units.
    delete state.lastQuestionContext!.intent;
    expect(createReplyReferenceSnapshotV5(input)!.pendingQuestion).toBeNull();
    expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, input)).toBeNull();
  });

  it('keeps an eligible nested question even after its original user source leaves the window', () => {
    const older = [...messages.slice(0, 2), ...Array.from({ length: 9 }, (_, index) => ({
      id: `c:turn:${index + 4}:user`, role: 'user' as const, content: '後続発話', createdAt: messages[0].createdAt,
    })), { ...messages[2], id: 'c:turn:13:assistant' }];
    const state = question();
    state.lastQuestionContext!.presentation!.assistantMessageId = 'c:turn:13:assistant';
    state.lastQuestionContext!.presentation!.turnId = 'c:turn:13';
    const snapshot = createReplyReferenceSnapshotV5({ graph: fixture(), messages: older,
      previousState: state, inputStateRevision: 7, conversationId: 'c' })!;
    expect(snapshot.pendingQuestion?.messageOrdinal).toBe(12);
    expect(snapshot.candidates).toEqual([expect.objectContaining({ sourceMessageId: 'c:turn:13:assistant',
      targetKind: 'workload', slot: 'duration_per_unit', componentPath: ['青チャート', '微積分'] })]);
  });

  it('reaches older nested facts through a recent active task anchor without changing provenance', () => {
    const graph = fixture();
    graph.tasks[0].source.turnId = 'c:request:12';
    const before = structuredClone(graph);
    const taskMessage = { ...messages[0], id: 'c:turn:12:user' };
    const history = [messages[1], ...Array.from({ length: 8 }, (_, index) => ({
      id: `c:turn:${index + 4}:user`, role: 'user' as const, content: '後続発話', createdAt: taskMessage.createdAt,
    })), taskMessage];
    const snapshot = createReplyReferenceSnapshotV5({ graph, messages: history, inputStateRevision: 7, conversationId: 'c' })!;
    expect(snapshot.candidates.find(item => item.targetFactId === 'work' && item.slot === 'quantity'))
      .toMatchObject({ sourceMessageId: taskMessage.id, sourceTurnId: 'c:request:12',
        componentPath: ['青チャート', '微積分'] });
    expect(graph).toEqual(before);
    graph.factLifecycles.find(item => item.factId === 'topic')!.status = 'removed';
    expect(createReplyReferenceSnapshotV5({ graph, messages: history, inputStateRevision: 7, conversationId: 'c' })).toBeNull();
  });

  it('does not resurrect answered, superseded, revised or closed questions from dialogue', () => {
    const input = { graph: fixture(), messages, previousState: question(), inputStateRevision: 7, conversationId: 'c' };
    const snapshot = createReplyReferenceSnapshotV5(input)!;
    const terminal = fixture();
    terminal.factLifecycles.find(item => item.factId === 'work')!.status = 'superseded';
    const accompanied = question();
    accompanied.lastQuestionContext!.presentation!.content.selfRepairNotice = true;
    const variants = [
      { ...input, previousState: undefined },
      { ...input, inputStateRevision: 8 },
      { ...input, graph: { ...fixture(), revision: 4 } },
      { ...input, graph: terminal },
      { ...input, previousState: accompanied },
      { ...input, messages: messages.map(message => message.role === 'assistant'
        ? { ...message, content: '長'.repeat(601) } : message) },
      { ...input, messages: [...messages, { id: 'c:turn:4:user', role: 'user' as const,
        content: '回答済み', createdAt: messages[0].createdAt }] },
      { ...input, messages: [...messages, { id: 'c:turn:4:assistant', role: 'assistant' as const,
        content: '新しい話題', createdAt: messages[0].createdAt }] },
    ];
    for (const current of variants) {
      const next = createReplyReferenceSnapshotV5(current)!;
      expect(next.pendingQuestion).toBeNull();
      expect(next.candidates.every(item => item.sourceMessageId !== 'c:turn:3:assistant')).toBe(true);
      expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, current)).toBeNull();
    }
  });

  it('rejects changed question identity even when revisions, text and destination remain equal', () => {
    const input = { graph: fixture(), messages, previousState: question(), inputStateRevision: 7, conversationId: 'c' };
    const snapshot = createReplyReferenceSnapshotV5(input)!;
    const revisedState = question();
    revisedState.lastQuestionContext!.actionId = 'different-action';
    const current = { ...input, previousState: revisedState };
    expect(createReplyReferenceSnapshotV5(current)!.candidates).toEqual(snapshot.candidates);
    expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, current)).toBeNull();
  });

  it('fails closed for missing ancestors and a domain wider than its explicit bound', () => {
    const graph = fixture();
    graph.components[1].parentComponentId = 'absent';
    expect(createReplyReferenceSnapshotV5({ graph, messages, inputStateRevision: 7, conversationId: 'c' })).toBeNull();
    const crowded = fixture();
    for (let i = 0; i < 20; i += 1) {
      const fact = { ...crowded.workloads[0], id: 'work-' + i };
      crowded.workloads.push(fact);
      crowded.factLifecycles.push({ factId: fact.id, status: 'active',
        createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null });
    }
    expect(createReplyReferenceSnapshotV5({ graph: crowded, messages, inputStateRevision: 7, conversationId: 'c' })).toBeNull();
  });

  it('copies only independently validated source offsets without parsing Japanese meaning', () => {
    const userText = '数学を📘で3分くらい';
    const start = userText.indexOf('3分');
    expect(extractReplyReferenceEvidenceV5(userText, { start, end: start + 2 })).toBe('3分');
    expect(extractReplyReferenceEvidenceV5(userText, { start: -1, end: 2 })).toBeNull();
    expect(extractReplyReferenceEvidenceV5(userText, { start: 4, end: 5 })).toBeNull();
    expect(extractReplyReferenceEvidenceV5(userText, { start: 0, end: 0 })).toBeNull();
  });
});

describe('calibrated read-only Jev reference choice', () => {
  const sourceInput = () => ({ graph: fixture(), messages, previousState: question(), inputStateRevision: 7, conversationId: 'c' });
  function calibration(): ReplyReferenceChoiceCalibrationV5 {
    const count = createReplyReferenceSnapshotV5(sourceInput())!.candidates.length + 1;
    return { maximumChildrenPerMenu: 64,
      policy: { id: 'test-only', calibrationEvidenceId: 'mock-calibration-not-for-production',
        rules: [{ menuKind: 'leaves', optionCount: count, depth: 0, minimumTopProbability: 0.9, minimumMargin: 0.7 }] },
      semanticPolicy: { calibrationEvidenceId: 'mock-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 },
    };
  }
  function response(request: Parameters<Parameters<typeof selectReplyReferenceHintV5>[0]['port']['choose']>[0],
    selectedKey: string, semanticSufficiency: 'only_candidate_meaning' | 'extra_or_uncertain_meaning' = 'only_candidate_meaning') {
    const selected = request.menu.options.find(option => option.kind === 'leaf' && option.candidate.id === selectedKey)!;
    return { requestId: request.requestId, nodeId: request.menu.nodeId,
      selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
      optionId: selected.id, semanticSufficiency,
      probabilities: request.menu.options.map(option => ({ optionId: option.id,
        probability: option.id === selected.id ? 0.99 : option.id === 'none' ? 0.01 : 0 })),
    };
  }

  it('returns only an anchored target/slot after an explicit gate and leaves graph untouched', async () => {
    const input = sourceInput();
    const before = structuredClone(input.graph);
    const chosen = createReplyReferenceSnapshotV5(input)!.candidates.find(
      item => item.sourceMessageId === 'c:turn:3:assistant' && item.slot === 'duration_per_unit')!;
    const selected = await selectReplyReferenceHintV5({
      source: input, readCurrent: () => input, userText: '1問3分くらい',
      ownerId: 'owner', conversationId: 'c', requestId: 'next',
      calibration: calibration(),
      port: { choose: async (request, beforeDispatch) => {
        expect(request.context.question.code).toBe('reply_reference_target');
        expect(request.context.scope.dialogueHistory).toEqual([
          { messageOrdinal: 1, role: 'user', content: '数学をやりたい' },
          { messageOrdinal: 2, role: 'user', content: '青チャートの微積分を20問' },
          { messageOrdinal: 3, role: 'assistant', content: '1問あたりの時間は？' },
        ]);
        expect(request.context.scope.pendingQuestion).toEqual({ messageOrdinal: 3,
          questionCode: 'stable_v5:missing_effort_estimate', candidateKeys: [chosen.key] });
        expect(JSON.stringify(request)).not.toContain('"taskFactId"');
        expect(JSON.stringify(request)).not.toContain('assistantMessageId');
        expect(JSON.stringify(request)).not.toContain('pendingQuestionBinding');
        beforeDispatch();
        return response(request, chosen.key);
      } },
    });
    expect(selected).toMatchObject({ key: chosen.key, targetFactId: 'work', slot: 'duration_per_unit' });
    expect(input.graph).toEqual(before);
  });

  it('abstains without calibration, with extra meaning or after source revision drift', async () => {
    const input = sourceInput();
    const chosen = createReplyReferenceSnapshotV5(input)!.candidates[0];
    let calls = 0;
    const base = {
      source: input, readCurrent: () => input, userText: 'それで',
      ownerId: 'owner', conversationId: 'c', requestId: 'next',
      port: { choose: async (request: Parameters<Parameters<typeof selectReplyReferenceHintV5>[0]['port']['choose']>[0],
        beforeDispatch: () => void) => {
        calls++; beforeDispatch(); return response(request, chosen.key, 'extra_or_uncertain_meaning');
      } },
    };
    expect(await selectReplyReferenceHintV5({ ...base, calibration: null })).toBeNull();
    expect(calls).toBe(0);
    expect(await selectReplyReferenceHintV5({ ...base, calibration: calibration() })).toBeNull();
    const drift = sourceInput();
    expect(await selectReplyReferenceHintV5({ ...base, calibration: calibration(),
      readCurrent: () => drift,
      port: { choose: async (request, beforeDispatch) => {
        beforeDispatch();
        drift.graph.revision++;
        return response(request, chosen.key);
      } },
    })).toBeNull();
  });

  it('hashes private question identity and rejects its mutation while Choice is in flight', async () => {
    const first = sourceInput();
    const revised = sourceInput();
    revised.previousState.lastQuestionContext!.actionId = 'new-question-action';
    const hashes: string[] = [];
    for (const input of [first, revised]) {
      await selectReplyReferenceHintV5({ source: input, readCurrent: () => input, userText: '回答',
        ownerId: 'owner', conversationId: 'c', requestId: 'same-request', calibration: calibration(),
        port: { choose: async (request, beforeDispatch) => {
          hashes.push(request.candidateSetHash); beforeDispatch(); return null;
        } } });
    }
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
    const selected = createReplyReferenceSnapshotV5(first)!.candidates.find(item => item.slot === 'duration_per_unit')!;
    expect(await selectReplyReferenceHintV5({ source: first, readCurrent: () => first, userText: '回答',
      ownerId: 'owner', conversationId: 'c', requestId: 'same-request', calibration: calibration(),
      port: { choose: async (request, beforeDispatch) => {
        beforeDispatch(); first.previousState.lastQuestionContext!.actionId = 'changed-after-send';
        return response(request, selected.key);
      } } })).toBeNull();
  });
});

describe('reference hint stays presentation-only for Luna', () => {
  it('does not change the default prompt and requires semantic interpretation when present', () => {
    const baseline = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '1問3分くらい', publicStateSummary: {},
    });
    const hinted = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '1問3分くらい', publicStateSummary: {
        replyReferenceHint: { targetFactId: 'work', slot: 'duration_per_unit',
          authority: 'non_authoritative_semantic_hint' },
      },
    });
    expect(baseline[0].content).not.toContain('replyReferenceHint');
    expect(hinted[0].content).toContain('non-authoritative');
    expect(hinted[0].content).toContain('independently extract and validate');
    expect(hinted[1].content).toContain('replyReferenceHint');
    expect(baseline[1].content).not.toContain('replyReferenceHint');
  });
});
