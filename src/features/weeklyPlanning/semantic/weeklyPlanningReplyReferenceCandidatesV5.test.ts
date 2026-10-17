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
  return graph;
}
function question(): PlanningIntakeState {
  return { lastQuestionContext: {
    kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work',
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
    const amount = snapshot.candidates.find(item => item.sourceMessageId === 'c:turn:2:user'
      && item.targetFactId === 'work' && item.slot === 'quantity')!;
    expect(amount).toMatchObject({ targetKind: 'workload', taskFactId: 'task',
      componentPath: ['青チャート', '微積分'], operation: 'set_value' });
    expect(snapshot.candidates.some(item => item.sourceMessageId === 'c:turn:3:assistant'
      && item.targetFactId === 'work' && item.slot === 'duration_per_unit')).toBe(true);
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

  it('fails closed for missing ancestors and a domain wider than its explicit bound', () => {
    const graph = fixture();
    graph.components[1].parentComponentId = 'absent';
    expect(createReplyReferenceSnapshotV5({ graph, messages, inputStateRevision: 7, conversationId: 'c' })).toBeNull();
    const crowded = fixture();
    for (let i = 0; i < 20; i += 1) {
      crowded.workloads.push({ ...crowded.workloads[0], id: 'work-' + i });
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
        expect(JSON.stringify(request)).not.toContain('"taskFactId"');
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
