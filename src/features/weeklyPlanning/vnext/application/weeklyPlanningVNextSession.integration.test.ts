import { describe, expect, it } from 'vitest';
import { parseWeeklyPlanningStableV5PersistedSession } from '../../application/weeklyPlanningStableV5SessionCodec';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../../intake/weeklyPlanningQuestionPresentation';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from '../../semantic/weeklyPlanningFactGraphV5';
import type { PlanningIntakeState } from '../../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../../types';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn } from '../semantic/weeklyPlanningVNextTransaction';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';
import type { WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { bindWeeklyPlanningVNextAnswer } from './weeklyPlanningVNextAnswerBinding';
import { resolveWeeklyPlanningConversationCore, WEEKLY_PLANNING_VNEXT_SWITCH_PARTS } from './weeklyPlanningVNextCoreSwitch';
import {
  migrateWeeklyPlanningV5GraphToVNextSession,
  parseWeeklyPlanningVNextSessionCheckpoint,
  serializeWeeklyPlanningVNextSessionCheckpoint,
} from './weeklyPlanningVNextSessionCheckpoint';

const conversationId = 'conversation-vnext-session';
const source = (semanticLocalId: string) => ({
  conversationId, turnId: 'turn-1', semanticLocalId, sourceText: 'fixture', origin: 'user' as const,
});

function workload(id: string, role: WorkloadFactV5['quantityRole'], amount: number, semanticLocalId = id): WorkloadFactV5 {
  return {
    id, taskId: 'task-1', componentId: null, quantityRole: role, amount, unitCode: 'page', unitLabel: 'ページ',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
    source: source(semanticLocalId), createdRevision: 1,
  };
}

/** A saved V5 graph: total 20, completed 12, and a V5-stored derived remaining 8. */
function savedV5Graph(): WeeklyPlanningFactGraphV5 {
  const workloads = [
    workload('total', 'scope_total', 20),
    workload('completed', 'completed', 12),
    workload('derived', 'remaining', 8, 'completed:derived-bounded-remaining:derived'),
  ];
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 4,
    tasks: [{ id: 'task-1', category: 'study', title: 'スライド', source: source('task-1'), createdRevision: 1 }],
    workloads,
    factLifecycles: [{ id: 'task-1' }, ...workloads].map((fact) => ({
      factId: fact.id, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null,
    })),
  };
}

function presentedIntake(params: { planningStateRevision: number; assistantMessageId: string; graphRevision: number }): PlanningIntakeState {
  return {
    lastQuestionContext: {
      kind: 'missing',
      targetSlot: 'stable_v5:missing_effort_estimate',
      intent: 'total_duration',
      presentation: {
        version: 1, turnId: 'turn-present', assistantMessageId: params.assistantMessageId,
        planningStateRevision: params.planningStateRevision, graphRevision: params.graphRevision,
        content: { responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
          groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
      },
    },
  } as unknown as PlanningIntakeState;
}

const assistant = (id: string): WeeklyPlanningMessage => ({ id, role: 'assistant', content: '何分かかりますか？' } as WeeklyPlanningMessage);
const user = (id: string): WeeklyPlanningMessage => ({ id, role: 'user', content: '60分' } as WeeklyPlanningMessage);

describe('VNext session: migration, answer binding inside presentation freshness, checkpoint', () => {
  it('migrates a saved V5 graph without touching it and makes earlier previews stale', () => {
    const v5 = savedV5Graph();
    const before = structuredClone(v5);
    const { state, notes } = migrateWeeklyPlanningV5GraphToVNextSession(v5);
    expect(v5).toEqual(before);
    expect(state.graph.revision).toBe(5);
    expect(notes).toContainEqual({ code: 'derived_workload_dropped', factId: 'derived' });
    expect(projectWeeklyPlanningVNext(state).questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8 } });
  });

  it('binds a fresh estimate answer to the asked work and the question closes', () => {
    let state: WeeklyPlanningVNextState = migrateWeeklyPlanningV5GraphToVNextSession(savedV5Graph()).state;
    const projection = projectWeeklyPlanningVNext(state);
    const presented = { questionKey: projection.questions[0].key, graphRevision: projection.graphRevision };
    const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: presentedIntake({ planningStateRevision: 7, assistantMessageId: 'a1', graphRevision: state.graph.revision }),
      inputStateRevision: 7,
      messages: [assistant('a1')],
      graphRevision: state.graph.revision,
    });
    expect(freshness.status).toBe('fresh');
    const binding = bindWeeklyPlanningVNextAnswer({
      freshness, presented, projection, leafOf: createVNextLineageResolver(state.graph).leafOf,
      answer: { kind: 'estimate_minutes', minutes: 60, taskFactId: 'task-1' },
    });
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') return;
    const applied = applyWeeklyPlanningVNextTurn(state, binding.delta, {
      turnKey: 'answer-1', expectedRevision: state.graph.revision, conversationId, turnId: 'turn-answer', sourceText: '60分',
    });
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') return;
    state = applied.state;
    expect(projectWeeklyPlanningVNext(state)).toMatchObject({
      questions: [], readiness: 'ready', owners: [{ work: [{ amount: 8, minutes: 60, estimateBasis: 'work_total' }] }],
    });
  });

  it('re-presents instead of applying an answer given after another message', () => {
    const state = migrateWeeklyPlanningV5GraphToVNextSession(savedV5Graph()).state;
    const projection = projectWeeklyPlanningVNext(state);
    const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: presentedIntake({ planningStateRevision: 7, assistantMessageId: 'a1', graphRevision: state.graph.revision }),
      inputStateRevision: 7,
      messages: [assistant('a1'), user('u1'), assistant('a2')],
      graphRevision: state.graph.revision,
    });
    const binding = bindWeeklyPlanningVNextAnswer({
      freshness,
      presented: { questionKey: projection.questions[0].key, graphRevision: projection.graphRevision },
      projection, leafOf: createVNextLineageResolver(state.graph).leafOf,
      answer: { kind: 'estimate_minutes', minutes: 60, taskFactId: 'task-1' },
    });
    expect(binding).toEqual({ status: 'represent', question: projection.questions[0] });
  });

  it('round-trips a VNext checkpoint, and the current V5 reader rejects it instead of misreading it', () => {
    const state = migrateWeeklyPlanningV5GraphToVNextSession(savedV5Graph()).state;
    const projection = projectWeeklyPlanningVNext(state);
    const raw = serializeWeeklyPlanningVNextSessionCheckpoint({
      ownerId: 'owner-1', weekStartDate: '2026-11-02', conversationId,
      vnext: { state, presentedQuestion: { questionKey: projection.questions[0].key, graphRevision: projection.graphRevision } },
      savedAt: '2026-10-30T00:00:00.000Z',
    })!;
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: 'owner-1', weekStartDate: '2026-11-02' });
    expect(parsed?.vnext.state).toEqual(state);
    expect(projectWeeklyPlanningVNext(parsed!.vnext.state)).toEqual(projection);
    expect(parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId: 'owner-1', weekStartDate: '2026-11-02' })).toBeNull();
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: 'other-owner', weekStartDate: '2026-11-02' })).toBeNull();
    const tampered = JSON.parse(raw);
    tampered.vnext.state.graph.effortEstimates = [{ bogus: true }];
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: JSON.stringify(tampered), ownerId: 'owner-1', weekStartDate: '2026-11-02' })).toBeNull();
  });

  it('keeps Stable V5 unless every part of the switch is ready and adoption is requested', () => {
    const all = new Set(WEEKLY_PLANNING_VNEXT_SWITCH_PARTS);
    expect(resolveWeeklyPlanningConversationCore({ vnextRequested: false, readyParts: all })).toMatchObject({ core: 'stable_v5' });
    for (const part of WEEKLY_PLANNING_VNEXT_SWITCH_PARTS) {
      const partial = new Set(all);
      partial.delete(part);
      expect(resolveWeeklyPlanningConversationCore({ vnextRequested: true, readyParts: partial }))
        .toEqual({ core: 'stable_v5', missing: [part] });
    }
    expect(resolveWeeklyPlanningConversationCore({ vnextRequested: true, readyParts: all })).toEqual({ core: 'vnext' });
  });
});
