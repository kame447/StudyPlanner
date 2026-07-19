from __future__ import annotations

from pathlib import Path


regression_path = Path(
    "src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts"
)
regression = regression_path.read_text(encoding="utf-8")
regression = regression.replace(
    "message.split('\n')",
    "message.split('\\n')",
)
regression_path.write_text(regression, encoding="utf-8")

renderer_test_path = Path(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts"
)
renderer_test = renderer_test_path.read_text(encoding="utf-8")
old_renderer_expectation = "'対象分野はOSnetworkで受け取りました。'"
new_renderer_expectation = "'OSnetworkを1科目で受け取りました。'"
if old_renderer_expectation not in renderer_test:
    raise RuntimeError("renderer acknowledgement expectation was not found")
renderer_test_path.write_text(
    renderer_test.replace(old_renderer_expectation, new_renderer_expectation, 1),
    encoding="utf-8",
)

Path(
    "src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversation.integration.test.ts"
).write_text(
    r"""import { describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';

vi.mock('../../../lib/aiConfig', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/aiConfig')>(
    '../../../lib/aiConfig',
  );
  return {
    ...actual,
    getAiConfig: () => ({
      provider: 'rules' as const,
      baseUrl: '',
      model: '',
      apiKey: '',
    }),
    getAiConfigValidationMessage: () => undefined,
  };
});

import { executeWeeklyPlanningTurn } from '../weeklyPlanningTurnExecutor';

describe('observed weekly planning conversation integration', () => {
  it('runs the reported conversation through turn execution, state carry-over, and rendering', async () => {
    const messages: WeeklyPlanningMessage[] = [];
    let state: PlanningIntakeState | undefined;
    let sequence = 0;

    const submit = async (userText: string) => {
      sequence += 1;
      const result = await executeWeeklyPlanningTurn({
        previousState: state,
        messages: [...messages],
        userText,
        selectedDate: '2026-07-19',
        userId: 'integration-user',
        plans: [],
        scheduleTemplates: [],
        conversationId: 'integration-conversation',
        traceRequestId: `integration-request-${sequence}`,
        weekStartsOn: 'monday',
      });
      const createdAt = `2026-07-19T20:${String(sequence).padStart(2, '0')}:00.000Z`;
      messages.push(
        {
          id: `user-${sequence}`,
          role: 'user',
          content: userText,
          createdAt,
        },
        {
          id: `assistant-${sequence}`,
          role: 'assistant',
          content: result.message,
          createdAt,
        },
      );
      state = result.state;
      return result;
    };

    const first = await submit('今日の勉強計画を立ててください');
    expect(first.state.range?.calendarDayCount).toBe(1);
    expect(first.state.missing).not.toContain('planning_period');
    expect(first.message).not.toContain('今週・来週・週末');

    const second = await submit('院試の過去問 OSとネットワークを進めたいです');
    expect(second.state.examPrepScope?.fields).toEqual(['OS', 'ネットワーク']);
    expect(second.message).toContain('OSとネットワークの2分野');
    expect(second.message).not.toContain('今日の計画ですね');

    const third = await submit('3時間ぐらいです\n予定は特にないです');
    expect(third.state.unitRates).toEqual([
      expect.objectContaining({ minutesPerUnit: 180, source: 'user' }),
    ]);
    expect(third.message).toContain('3時間');
    expect(third.message).not.toContain('180分');

    const fourth = await submit('分野はOSとネットワークだけです');
    expect(fourth.message).toContain('進める順番だけ確認します');
    expect(fourth.message).not.toContain('睡眠時間や');
    expect(fourth.message.match(/？/g) ?? []).toHaveLength(1);

    const fifth = await submit('違う！OSとネットワークで一科目です');
    expect(fifth.state.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(fifth.state.examPrepScope?.totalFields).toBe(1);
    expect(fifth.message).toContain('OSとネットワークを1科目');
  });
});
""",
    encoding="utf-8",
)

Path(
    "workers/ai-proxy/src/weeklyPlanningTraceAdmin.integration.test.ts"
).write_text(
    r"""import { describe, expect, it, vi } from 'vitest';

const fakeFirestore = vi.hoisted(() => {
  const sessionId = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
  const conversationId = 'weekly-conversation-223e4567-e89b-12d3-a456-426614174000';
  const sessionDocument = {
    id: sessionId,
    logicalConversationId: conversationId,
    entryCount: 2,
    traceSubjectToken: 'wpt_hidden-session-token',
  };
  const entryDocuments = new Map<string, Record<string, unknown>>([
    [`${sessionId}-00000000`, {
      id: `${sessionId}-00000000`,
      sessionId: '[UUID]',
      logicalConversationId: conversationId,
      sequence: 0,
      content: 'first',
      traceSubjectToken: 'wpt_hidden-entry-token',
    }],
    [`${sessionId}-00000001`, {
      id: `${sessionId}-00000001`,
      sessionId: '[UUID]',
      logicalConversationId: conversationId,
      sequence: 1,
      content: 'second',
      traceSubjectToken: 'wpt_hidden-entry-token',
    }],
  ]);
  const auditWrites: Array<Record<string, unknown>> = [];

  class FakeWeeklyPlanningTraceFirestoreClient {
    async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
      if (collection === 'admins' && id === 'admin-user') {
        return { enabled: true, weeklyPlanningTraceReader: true };
      }
      if (collection === 'weekly_planning_trace_sessions' && id === sessionId) {
        return { ...sessionDocument };
      }
      if (collection === 'weekly_planning_trace_entries') {
        const entry = entryDocuments.get(id);
        return entry ? { ...entry } : null;
      }
      return null;
    }

    async queryDocuments(collection: string): Promise<Record<string, unknown>[]> {
      if (collection === 'weekly_planning_trace_sessions') {
        return [{ ...sessionDocument }];
      }
      if (collection === 'weekly_planning_trace_entries') {
        throw new Error('legacy sessionId query path must not be used');
      }
      return [];
    }

    async setImmutableDocument(
      _collection: string,
      _id: string,
      value: Record<string, unknown>,
    ): Promise<void> {
      auditWrites.push({ ...value });
    }

    async setDocument(): Promise<void> {}
    async deleteByStringField(): Promise<number> { return 0; }
  }

  return {
    sessionId,
    conversationId,
    auditWrites,
    FakeWeeklyPlanningTraceFirestoreClient,
  };
});

vi.mock('./weeklyPlanningTraceFirestore', () => ({
  WeeklyPlanningTraceFirestoreClient:
    fakeFirestore.FakeWeeklyPlanningTraceFirestoreClient,
}));

import { handleWeeklyPlanningTraceApi } from './weeklyPlanningTraceApi';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';

function env() {
  const epoch = resolveWeeklyPlanningTraceEpoch(new Date());
  return {
    FIREBASE_PROJECT_ID: 'integration-project',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-by-fake-client',
    WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({
      [epoch]: 'a'.repeat(32),
    }),
  };
}

describe('weekly planning trace admin API integration', () => {
  it('lists a session and retrieves its entries with the same opaque lookup ID', async () => {
    const sessionsResult = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/sessions'),
      env(),
      { uid: 'admin-user' },
    );

    expect(sessionsResult.status).toBe(200);
    const sessions = sessionsResult.body.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(fakeFirestore.sessionId);
    expect(sessions[0].logicalConversationId).toBe(fakeFirestore.conversationId);
    expect(JSON.stringify(sessions)).not.toContain('traceSubjectToken');

    const entriesResult = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: String(sessions[0].id) }),
      }),
      env(),
      { uid: 'admin-user' },
    );

    expect(entriesResult.status).toBe(200);
    const entries = entriesResult.body.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.id)).toEqual([
      `${fakeFirestore.sessionId}-00000000`,
      `${fakeFirestore.sessionId}-00000001`,
    ]);
    expect(entries.every((entry) => entry.sessionId === fakeFirestore.sessionId)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('traceSubjectToken');
    expect(fakeFirestore.auditWrites).toHaveLength(2);
  });
});
""",
    encoding="utf-8",
)
