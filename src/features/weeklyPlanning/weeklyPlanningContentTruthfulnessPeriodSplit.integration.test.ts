import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live X5: 「今日の夜と明日の朝に分けて、数学の課題を合わせて90分やりたい」. The model read a total
// with two preferred windows and no session structure, so one 90-minute block was placed tonight.
// The reading is model-owned; this test pins what deterministic code does with each typed shape.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const TEXT = '今日の夜と明日の朝に分けて、数学の課題を合わせて90分やりたい';

function window(localId: string, dateExpression: string, namedTimePeriod: string, sourceText: string): Json {
  return { localId, targetLocalId: 'task', kind: 'preferred_window', constraintLevel: 'soft', dateExpression,
    namedTimePeriod, startTime: null, endTime: null, precision: 'approximate', sourceText };
}

function reading(withSessions: boolean): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null,
    tasks: [{
      localId: 'task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の課題',
      study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: null, components: [] },
      workloads: [],
      effortEstimates: [
        { localId: 'total', targetLocalId: 'task', kind: 'total_duration', minutes: 90,
          unitCode: null, precision: 'approximate', sourceText: '合わせて90分' },
        ...(withSessions ? [{ localId: 'each', targetLocalId: 'task', kind: 'session_duration', minutes: 45,
          unitCode: null, precision: 'approximate', sourceText: '合わせて90分' }] : []),
      ],
      temporalConstraints: [
        window('w1', 'today', 'night', '今日の夜'),
        window('w2', 'tomorrow', 'morning', '明日の朝'),
      ],
      recurrence: withSessions
        ? [{ localId: 'split', targetLocalId: 'task', kind: 'custom', count: 2, days: [], sourceText: '今日の夜と明日の朝に分けて' }]
        : [],
      durableContextSignals: [], sourceText: '数学の課題を合わせて90分やりたい',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [],
  };
}

async function place(withSessions: boolean) {
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer'
    ? scriptedRendererReply(call, '候補を用意しました。')
    : JSON.stringify(reading(withSessions)));
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
  const turn = await conversation.submit(TEXT);
  const candidates = (conversation.getState().previewCandidates ?? []) as Array<{ date?: string; startTime?: string }>;
  return { turn, candidates };
}

describe('a total divided across named periods (X5)', () => {
  it('a reading without session structure places one block (the live failure shape)', async () => {
    const { candidates } = await place(false);
    expect(candidates).toHaveLength(1);
  });

  it('a reading that states one session per named period places one block per period', async () => {
    const { candidates } = await place(true);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map(candidate => candidate.date)).size).toBe(2);
  });
});
