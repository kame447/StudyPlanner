import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleWeeklyPlanningTraceApi } from './weeklyPlanningTraceApi';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';
import { WorkerSubrequestBudget } from './workerSubrequestBudget';

const BASE = 'https://firestore.googleapis.com/v1/projects/budget-project/databases/(default)/documents';

function env() {
  const current = Number(resolveWeeklyPlanningTraceEpoch(new Date()));
  // A root two years back gives the delete ring 24+ subject epochs.
  return {
    FIREBASE_PROJECT_ID: 'budget-project',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-with-token-provider',
    WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({ [current - 24]: 'r'.repeat(64) }),
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('weekly planning trace delete subrequest budget', () => {
  it('deletes 44 entries and a session across 24+ epochs well inside the Worker budget', async () => {
    const stored = new Map<string, string[]>([
      ['weekly_planning_trace_entries', Array.from({ length: 44 }, (_, index) => `entry-${index}`)],
      ['weekly_planning_trace_sessions', ['session-0']],
    ]);
    const urls: string[] = [];
    let inValueCount = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        structuredQuery?: {
          from: Array<{ collectionId: string }>;
          where?: { fieldFilter?: { field: { fieldPath: string }; op: string; value: { arrayValue?: { values: unknown[] } } } };
        };
        writes?: Array<{ delete?: string }>;
      };
      if (url === `${BASE}:runQuery`) {
        const query = body.structuredQuery!;
        const filter = query.where!.fieldFilter!;
        expect(filter.op).toBe('IN');
        inValueCount = Math.max(inValueCount, filter.value.arrayValue!.values.length);
        // Owner documents match the subject-token query only.
        const ids = filter.field.fieldPath === 'traceSubjectToken'
          ? stored.get(query.from[0].collectionId) ?? []
          : [];
        return new Response(JSON.stringify(ids.map((id) => ({
          document: { name: `projects/budget-project/databases/(default)/documents/${query.from[0].collectionId}/${id}` },
        }))), { status: 200 });
      }
      if (url === `${BASE}:commit`) {
        for (const write of body.writes ?? []) {
          if (!write.delete) continue;
          const [collection, id] = write.delete.split('/documents/')[1].split('/');
          stored.set(collection, (stored.get(collection) ?? []).filter((item) => item !== id));
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const budget = new WorkerSubrequestBudget('fetch', '/weekly-planning-trace/delete');
    const result = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/delete', { method: 'POST', body: '{}' }),
      env(),
      { uid: 'owner-1' },
      { getToken: async () => 'token', subrequestObserver: budget },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ deletedEntries: 44, deletedSessions: 1 });
    expect(stored.get('weekly_planning_trace_entries')).toEqual([]);
    expect(stored.get('weekly_planning_trace_sessions')).toEqual([]);
    expect(inValueCount).toBeGreaterThanOrEqual(25);
    // audit write + per collection (token IN query + commit + legacy userId query)
    expect(budget.snapshot().attemptedSubrequests).toBe(7);
    expect(urls.filter((url) => /\/documents\/weekly_planning_trace_(entries|sessions)\//.test(url)))
      .toEqual([]);
  });
});
