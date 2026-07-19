from __future__ import annotations

import subprocess
from pathlib import Path

ORIGINAL_COMMIT = "d5d25965c16750cc96f675da5e0b5958ea12d96a"
ORIGINAL_PATH = "scripts/apply_weekly_planning_trace_dialogue_fix.py"

source = subprocess.check_output(
    ["git", "show", f"{ORIGINAL_COMMIT}:{ORIGINAL_PATH}"],
    text=True,
)
source = source.replace(
    """    '- For Japanese exam years like 2025〜2019, set yearRange.startYear to 2025 and endYear to 2019.',
""",
    """    'For Japanese exam years like 2025〜2019, set yearRange.startYear to 2025 and endYear to 2019.',
""",
    1,
)
target = '''    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
'''
replacement = '''    old = old.replace("\\r?\\n", r"\\r?\\n")
    new = new.replace("\\r?\\n", r"\\r?\\n")
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
'''
if target not in source:
    raise RuntimeError("applicator normalization target was not found")

patched_source = source.replace(target, replacement, 1)
exec(
    compile(patched_source, str(Path(__file__)), "exec"),
    {"__name__": "__main__", "__file__": __file__},
)

renderer_path = Path(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts"
)
renderer = renderer_path.read_text(encoding="utf-8")
unused_blocks = [
    """  const priorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : undefined;
""",
    """function constraintSummary(state: PlanningIntakeState): string[] | undefined {
  const values = state.constraints.map((constraint) =>
    [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '),
  );

  return values.length > 0 ? values : undefined;
}

""",
]
for block in unused_blocks:
    if block not in renderer:
        raise RuntimeError(f"renderer cleanup target was not found: {block[:80]!r}")
    renderer = renderer.replace(block, "", 1)

replacements = [
    (
        """function planningPeriodLabel(
  state: PlanningIntakeState,
  latestTurn: string,
): string | undefined {
  const source = state.range?.sourceText;
  if (source && !acceptedFromLatestTurn(source, latestTurn)) return undefined;
""",
        """function planningPeriodLabel(
  state: PlanningIntakeState,
  latestTurn?: string,
): string | undefined {
  const source = state.range?.sourceText;
  if (source && latestTurn && !acceptedFromLatestTurn(source, latestTurn)) return undefined;
""",
    ),
    (
        """  const latestTurn = params.state.sourceTurns.at(-1) ?? '';
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && acceptedFromLatestTurn(rate.rawText, latestTurn),
  );
""",
        """  const latestTurn = params.state.sourceTurns.at(-1) ?? '';
  const useTurnDelta = Boolean(params.previousState);
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && (!useTurnDelta || acceptedFromLatestTurn(rate.rawText, latestTurn)),
  );
""",
    ),
    (
        """  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command' && acceptedFromLatestTurn(task.rawText, latestTurn))
    .map((task) => task.title);
  const examScopeAcceptedThisTurn = params.state.examPrepScope?.rawText.some(
    (sourceText) => acceptedFromLatestTurn(sourceText, latestTurn),
  ) ?? false;
""",
        """  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command'
      && (!useTurnDelta || acceptedFromLatestTurn(task.rawText, latestTurn)))
    .map((task) => task.title);
  const examScopeAcceptedThisTurn = !useTurnDelta || (params.state.examPrepScope?.rawText.some(
    (sourceText) => acceptedFromLatestTurn(sourceText, latestTurn),
  ) ?? false);
""",
    ),
    (
        """  const mentionsConstraintSource = /時間割|予定表|登録済みの予定|保存済みの予定/.test(latestTurn);

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, latestTurn),
""",
        """  const mentionsConstraintSource = !useTurnDelta
    || /時間割|予定表|登録済みの予定|保存済みの予定/.test(latestTurn);
  const acceptedConstraintSummary = params.state.constraints
    .filter((constraint) => !useTurnDelta || acceptedFromLatestTurn(constraint.rawText, latestTurn))
    .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '));

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, useTurnDelta ? latestTurn : undefined),
""",
    ),
    (
        """      yearRange: params.state.examPrepScope?.yearRange
        && latestTurn.includes(params.state.examPrepScope.yearRange.sourceText)
""",
        """      yearRange: params.state.examPrepScope?.yearRange
        && (!useTurnDelta || latestTurn.includes(params.state.examPrepScope.yearRange.sourceText))
""",
    ),
    (
        """      constraintSummary: params.state.constraints
        .filter((constraint) => acceptedFromLatestTurn(constraint.rawText, latestTurn))
        .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
          .filter(Boolean)
          .join(' ')),
""",
        """      constraintSummary: acceptedConstraintSummary.length > 0
        ? acceptedConstraintSummary
        : undefined,
""",
    ),
    (
        """    fields.length
      ? input.acceptedFacts.totalFields === 1 && fields.length === 1
        ? `${fieldList}を1科目`
        : `${fieldList}の${fields.length}分野`
      : null,
""",
        """    fields.length
      ? input.acceptedFacts.totalFields === 1 && fields.length === 1
        ? `${fieldList}を1科目`
        : fields.length === 1
          ? `対象分野は${fieldList}`
          : `${fieldList}の${fields.length}分野`
      : null,
""",
    ),
]
for old, new in replacements:
    if old not in renderer:
        raise RuntimeError(f"renderer compatibility target was not found: {old[:100]!r}")
    renderer = renderer.replace(old, new, 1)
renderer_path.write_text(renderer, encoding="utf-8")

regression_path = Path(
    "src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts"
)
regression = regression_path.read_text(encoding="utf-8")
regression = regression.replace(
    "'3時間ぐらいです\n予定は特にないです'",
    r"'3時間ぐらいです\n予定は特にないです'",
)
regression_path.write_text(regression, encoding="utf-8")

question_slots_test_path = Path(
    "src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.test.ts"
)
question_slots_test = question_slots_test_path.read_text(encoding="utf-8")
old_expected = "'週末で優先する分野や進める順番を教えてください。'"
new_expected = "'来週で優先する分野や進める順番を教えてください。'"
if old_expected not in question_slots_test:
    raise RuntimeError("priority question expectation was not found")
question_slots_test_path.write_text(
    question_slots_test.replace(old_expected, new_expected, 1),
    encoding="utf-8",
)

Path(
    "src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversation.integration.test.ts"
).write_text(
    r"""import { describe, expect, it } from 'vitest';
import { renderWeeklyPlanningDialogueMessage } from '../dialogue/weeklyPlanningDialogueRenderer';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { runWeeklyPlanningBehaviorAwarePipeline } from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';

const baseInput = {
  planningStartDate: '2026-07-19',
  planningDayCount: 7,
  currentDateTime: '2026-07-19T20:30:00',
  weekStartsOn: 'monday' as const,
  existingPlans: [],
  scheduleTemplates: [],
};

async function submit(previousState: PlanningIntakeState | undefined, userText: string) {
  const output = await runWeeklyPlanningBehaviorAwarePipeline({
    ...baseInput,
    previousState,
    userText,
  }, {
    conversationId: 'observed-conversation-integration',
    traceRequestId: `trace-${previousState?.sourceTurns.length ?? 0}`,
    userId: 'integration-user',
  });
  const message = await renderWeeklyPlanningDialogueMessage({
    state: output.state,
    previousState,
    decision: output.decision,
  });
  return { output, message };
}

describe('observed weekly planning conversation integration', () => {
  it('keeps period, accepted facts, and repair behavior coherent across the full multi-turn pipeline', async () => {
    const first = await submit(undefined, '今日の勉強計画を立ててください');
    expect(first.output.state.range).toMatchObject({
      startDateTime: '2026-07-19T20:30:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 1,
    });
    expect(first.message).toContain('具体的に何をどこまで進めたいか');
    expect(first.message).not.toMatch(/今週・来週・週末/);

    const second = await submit(
      first.output.state,
      '院試の過去問 OSとネットワークを進めたいです',
    );
    expect(second.output.state.examPrepScope?.fields).toEqual(['OS', 'ネットワーク']);
    expect(second.message).toContain('OSとネットワークの2分野');
    expect(second.message).not.toContain('今日の計画ですね');

    const third = await submit(
      second.output.state,
      '3時間ぐらいです\n予定は特にないです',
    );
    expect(third.output.state.unitRates[0]).toMatchObject({ minutesPerUnit: 180 });
    expect(third.output.state.fixedEventsDeclaredNone).toBe(true);
    expect(third.message).toContain('目安時間は3時間');
    expect(third.message).not.toContain('180分');

    const fourth = await submit(
      third.output.state,
      '分野はOSとネットワークだけです',
    );
    expect(fourth.message).toContain('進める順番だけ確認します');
    expect(fourth.message).not.toContain('睡眠時間や');
    expect(fourth.message.split('\n').filter((line) => line.includes('？'))).toHaveLength(1);
  });

  it('propagates an explicit one-subject correction through parser, state, and renderer', async () => {
    const first = await submit(undefined, '今日の勉強計画を立ててください');
    const second = await submit(
      first.output.state,
      '院試の過去問 OSとネットワークを進めたいです',
    );
    const corrected = await submit(
      second.output.state,
      '違う、OSとネットワークで一科目です',
    );

    expect(corrected.output.state.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(corrected.output.state.examPrepScope?.totalFields).toBe(1);
    expect(corrected.message).toContain('OSとネットワークを1科目');
  });
});
""",
    encoding="utf-8",
)

Path(
    "workers/ai-proxy/src/weeklyPlanningTraceAdmin.integration.test.ts"
).write_text(
    r"""import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleWeeklyPlanningTraceApi,
  type WeeklyPlanningTraceApiEnv,
} from './weeklyPlanningTraceApi';

type FirestoreValue = Record<string, unknown>;
type FirestoreDocument = { name: string; fields: Record<string, FirestoreValue> };

const env: WeeklyPlanningTraceApiEnv = {
  FIREBASE_PROJECT_ID: 'integration-project',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({
    '100': 'a'.repeat(32),
    '200': 'b'.repeat(32),
    '300': 'c'.repeat(32),
  }),
};

const USER_SESSION = { uid: 'trace-user' };
const ADMIN_SESSION = { uid: 'trace-admin' };
const SESSION_A = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const SESSION_B = 'weekly-trace-223e4567-e89b-12d3-a456-426614174000';

function firestoreString(value: string): FirestoreValue {
  return { stringValue: value };
}

function firestoreBoolean(value: boolean): FirestoreValue {
  return { booleanValue: value };
}

class MemoryFirestoreHttp {
  readonly documents = new Map<string, FirestoreDocument>();

  seed(collection: string, id: string, fields: Record<string, FirestoreValue>): void {
    this.documents.set(`${collection}/${id}`, {
      name: this.documentName(collection, id),
      fields,
    });
  }

  private documentName(collection: string, id: string): string {
    return `projects/integration-project/databases/(default)/documents/${collection}/${id}`;
  }

  private decodeString(value: FirestoreValue | undefined): string | undefined {
    return typeof value?.stringValue === 'string' ? value.stringValue : undefined;
  }

  private collectionDocuments(collection: string): FirestoreDocument[] {
    const prefix = `${collection}/`;
    return Array.from(this.documents.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, document]) => document);
  }

  fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'integration-token', expires_in: 3600 });
    }

    if (url.endsWith('/documents:runQuery')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        structuredQuery?: {
          from?: Array<{ collectionId?: string }>;
          where?: { fieldFilter?: { field?: { fieldPath?: string }; value?: FirestoreValue } };
          limit?: number;
        };
      };
      const query = body.structuredQuery ?? {};
      const collection = query.from?.[0]?.collectionId ?? '';
      const fieldPath = query.where?.fieldFilter?.field?.fieldPath;
      const expected = this.decodeString(query.where?.fieldFilter?.value);
      const documents = this.collectionDocuments(collection)
        .filter((document) => !fieldPath || this.decodeString(document.fields[fieldPath]) === expected)
        .slice(0, query.limit ?? 500);
      return Response.json(documents.map((document) => ({ document })));
    }

    const match = url.match(/\/documents\/([^/?]+)\/([^?]+)(?:\?.*)?$/);
    if (!match) return new Response('not found', { status: 404 });
    const collection = decodeURIComponent(match[1]);
    const id = decodeURIComponent(match[2]);
    const key = `${collection}/${id}`;

    if ((init?.method ?? 'GET') === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { fields?: Record<string, FirestoreValue> };
      const previous = this.documents.get(key);
      const updateMask = new URL(url).searchParams.getAll('updateMask.fieldPaths');
      const fields = updateMask.length > 0
        ? {
            ...(previous?.fields ?? {}),
            ...Object.fromEntries(updateMask.map((field) => [field, body.fields?.[field] ?? { nullValue: null }])),
          }
        : (body.fields ?? {});
      this.documents.set(key, { name: this.documentName(collection, id), fields });
      return Response.json({ name: this.documentName(collection, id), fields });
    }

    if ((init?.method ?? 'GET') === 'DELETE') {
      this.documents.delete(key);
      return new Response(null, { status: 200 });
    }

    const document = this.documents.get(key);
    return document
      ? Response.json(document)
      : new Response('not found', { status: 404 });
  });
}

function request(path: string, method: 'GET' | 'POST', body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function tracePayload(sessionId: string, content: string) {
  return {
    session: {
      id: sessionId,
      logicalConversationId: `conversation-${sessionId}`,
      status: 'active',
      entryCount: 1,
    },
    entries: [{
      id: `${sessionId}-00000000`,
      sessionId,
      logicalConversationId: `conversation-${sessionId}`,
      sequence: 0,
      kind: 'turn',
      content,
    }],
  };
}

describe('weekly planning trace admin API integration', () => {
  let memory: MemoryFirestoreHttp;

  beforeEach(() => {
    memory = new MemoryFirestoreHttp();
    memory.seed('admins', ADMIN_SESSION.uid, {
      enabled: firestoreBoolean(true),
      weeklyPlanningTraceReader: firestoreBoolean(true),
    });
    vi.stubGlobal('fetch', memory.fetch);
    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
      subtle: {
        importKey: async () => ({}) as CryptoKey,
        sign: async () => new Uint8Array([1, 2, 3]).buffer,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes two UUID sessions and retrieves each session and its entries without identifier collapse', async () => {
    const acceptance = await handleWeeklyPlanningTraceApi(
      request('/weekly-planning-trace/policy/accept', 'POST'),
      env,
      USER_SESSION,
    );
    expect(acceptance.status).toBe(200);

    for (const [sessionId, content] of [[SESSION_A, 'first'], [SESSION_B, 'second']] as const) {
      const appended = await handleWeeklyPlanningTraceApi(
        request('/weekly-planning-trace/append', 'POST', tracePayload(sessionId, content)),
        env,
        USER_SESSION,
      );
      expect(appended).toMatchObject({
        status: 200,
        body: { sessionId, acceptedEntries: 1 },
      });
    }

    const sessionsResult = await handleWeeklyPlanningTraceApi(
      request('/weekly-planning-trace/admin/sessions', 'GET'),
      env,
      ADMIN_SESSION,
    );
    expect(sessionsResult.status).toBe(200);
    const sessions = sessionsResult.body.sessions as Array<Record<string, unknown>>;
    expect(sessions.map((session) => session.id).sort()).toEqual([SESSION_A, SESSION_B].sort());
    expect(new Set(sessions.map((session) => session.id)).size).toBe(2);

    const entriesResult = await handleWeeklyPlanningTraceApi(
      request('/weekly-planning-trace/admin/entries', 'POST', { sessionId: SESSION_A }),
      env,
      ADMIN_SESSION,
    );
    expect(entriesResult.status).toBe(200);
    expect(entriesResult.body.entries).toEqual([
      expect.objectContaining({
        id: `${SESSION_A}-00000000`,
        sessionId: SESSION_A,
        content: 'first',
      }),
    ]);

    const archiveResult = await handleWeeklyPlanningTraceApi(
      request('/weekly-planning-trace/admin/archive', 'POST', { sessionId: SESSION_A }),
      env,
      ADMIN_SESSION,
    );
    expect(archiveResult).toMatchObject({ status: 200, body: { sessionId: SESSION_A } });
    expect(memory.documents.get(`weekly_planning_trace_sessions/${SESSION_A}`)?.fields.archivedAt)
      .toBeDefined();
    expect(memory.documents.get(`weekly_planning_trace_sessions/${SESSION_B}`)?.fields.archivedAt)
      .toBeUndefined();
  });
});
""",
    encoding="utf-8",
)
