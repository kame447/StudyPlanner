import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './semantic/weeklyPlanningSemanticNormalizerV5';

// Live D T3: the reading restated accepted tasks with empty quotes and the single repair restated
// their workloads with quotes the user did not write, so the turn was lost. The repair now carries
// a typed directive (error code + existingPublicId binding); a repair that returns only the
// current-turn changes is accepted.
const userText = '1回1時間くらいで2回に分けたい。どっちも夜がいい';
type Json = Record<string, unknown>;

function task(publicId: string, title: string, extra: Json): Json {
  return { localId: `t_${publicId}`, existingPublicId: publicId, decompositionStatus: 'atomic', category: 'study', title,
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
    sourceText: userText, ...extra };
}
const wrap = (tasks: Json[]) => JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan',
  planningWindow: null, tasks, relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
  userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [] });

const summary = { graphRevision: 3, pendingQuestion: null, components: [], workloads: [],
  tasks: [{ publicId: 'task-a', category: 'study', title: '読み物' }, { publicId: 'task-b', category: 'study', title: 'ノート' }] };
const restated = (title: string, quote: string) => ({ workloads: [{ localId: `w_${title}`, quantityRole: 'target', amount: 20,
  unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: quote }] });
const change = (id: string) => ({
  effortEstimates: [{ localId: `e_${id}`, targetLocalId: `t_${id}`, kind: 'session_duration', minutes: 60, unitCode: null,
    precision: 'approximate', sourceText: '1回1時間' }],
  temporalConstraints: [{ localId: `p_${id}`, targetLocalId: `t_${id}`, kind: 'preferred_window', constraintLevel: 'soft',
    dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText: '夜がいい' }],
});

async function run(arch: 'interaction_v1' | 'legacy_v5') {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const responses = [
    // reading: restated with a stale quote on the workload (not in the current text)
    wrap([task('task-a', '読み物', { ...restated('a', '20ページ'), ...change('task-a') }),
      task('task-b', 'ノート', { ...restated('b', '2時間'), ...change('task-b') })]),
    // repair that follows the directive: only the current-turn changes
    wrap([task('task-a', '読み物', change('task-a')), task('task-b', 'ノート', change('task-b'))]),
  ];
  let index = 0;
  const client = { async createChatCompletion(input: { messages: Array<{ role: string; content: string }> }) {
    calls.push(input);
    return responses[index++] ?? responses[1];
  } } as unknown as OpenAiCompatibleClient;
  const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
    userText, publicStateSummary: summary, conversationArchitecture: arch });
  return { result, calls };
}

describe('a repair of restated accepted facts is told to return only the current-turn changes', () => {
  it('interaction: the one repair carries the typed directive and its compliant result is accepted', async () => {
    const { result, calls } = await run('interaction_v1');
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[calls[1].messages.length - 1].content).toContain('Do not restate');
    expect(result.status).toBe('accepted');
    expect(result.diagnostics.repairAttempted).toBe(true);
  });

  it('legacy: the repair message is the historical one', async () => {
    const { calls } = await run('legacy_v5');
    expect(calls[1]?.messages[calls[1].messages.length - 1].content ?? '').not.toContain('Do not restate');
  });
});
