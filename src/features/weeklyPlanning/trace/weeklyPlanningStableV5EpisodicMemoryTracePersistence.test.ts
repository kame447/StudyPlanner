import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

function repositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) { writes.push(structuredClone(params)); },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { repository, writes };
}

function diagnostic(entries: WeeklyPlanningTraceEntry[]): WeeklyPlanningTraceTurnDiagnosticEntry {
  const entry = entries[0];
  if (!entry || entry.kind !== 'turn_diagnostic') {
    throw new Error('expected turn diagnostic');
  }
  return entry;
}

describe('Stable V5 episodic memory trace persistence', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('keeps graph-backed episodic evidence in the persisted semantic input diagnostic', async () => {
    const harness = repositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const episodicMemory = {
      version: 'weekly-planning-episodic-memory-v5',
      items: [{
        sourceRequestId: 'conversation-memory:request:1',
        sourceSequence: 1,
        factIds: ['task-math', 'workload-math'],
        userMessage: null,
        sourceExcerpts: ['数学のワークは残り50ページです'],
        recoveredFrom: 'fact_source',
      }],
    };

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-memory',
      conversationId: 'conversation-memory',
      requestId: 'conversation-memory:request:12',
      userText: 'それは夜の方がいいです',
      assistantMessage: '条件を更新しました。',
      outcome: 'revision_pending',
      previewCount: 0,
      debugTraceEvents: [{
        schemaVersion: 2,
        sequence: 0,
        stage: 'semantic_pipeline_input',
        occurredAt: '2026-08-11T09:00:00.000Z',
        severity: 'debug',
        data: {
          userText: 'それは夜の方がいいです',
          recentConversation: [],
          publicStateSummary: {
            graphRevision: 4,
            episodicMemory,
          },
        },
      }],
    });

    expect(harness.writes).toHaveLength(1);
    const entry = diagnostic(harness.writes[0].entries);
    expect(entry.aiInterpreter.input.planningStateSummary).toMatchObject({
      graphRevision: 4,
      episodicMemory,
    });
  });
});
