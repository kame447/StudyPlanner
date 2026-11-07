import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { createWeeklyPlanningVNextProviderInterpreter } from './weeklyPlanningVNextProvider';
import { checkVNextProviderScenario, VNEXT_PROVIDER_SCENARIOS } from './weeklyPlanningVNextProviderScenarios';
import { presentWeeklyPlanningVNextQuestion } from '../application/weeklyPlanningVNextQuestionText';
import { resolveWeeklyPlanningVNextTurnDelta } from '../application/weeklyPlanningVNextAnswerBinding';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from '../application/weeklyPlanningVNextExperimentalSession';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const run = shouldRun ? describe : describe.skip;
const outputDir = join(process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/weekly-planning-real-api', 'vnext-provider');
const defaultClock = { defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, weekStartsOn: 'monday' as const, currentDate: '2026-10-30', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
const empty = () => ({ add: [], patch: [], remove: [], relate: [], defer: [] });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the workflow-only native provider observation`);
  return value;
}

run('VNext native provider synthetic real API observations', () => {
  for (const scenario of VNEXT_PROVIDER_SCENARIOS) {
    it(scenario.id, async () => {
      const clock = scenario.clock ?? defaultClock;
      const observations: unknown[] = [];
      const failures: string[] = [];
      let state = createEmptyWeeklyPlanningVNextState();
      const artifact: Record<string, unknown> = { scenario: scenario.id, clock, syntheticOnly: true,
        provider: 'native-vnext', observations, failures, completed: false };
      try {
        if (requiredEnv('VITE_AI_PROVIDER') !== 'openai') throw new Error('VITE_AI_PROVIDER must select the authorized OpenAI-compatible transport');
        const model = requiredEnv('VITE_AI_MODEL');
        artifact.model = model;
        const actual = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: requiredEnv('VITE_AI_BASE_URL'),
          model, apiKey: requiredEnv('VITE_AI_API_KEY'), requestTimeoutMs: 90_000 });
        let receipts: unknown[] = [];
        const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
          // Capture only caller messages/schema, never config, credentials, headers or transport errors.
          const receipt: Record<string, unknown> = { request: structuredClone(request) };
          receipts.push(receipt);
          try { const response = await actual.createChatCompletion(request); receipt.response = response; return response; }
          catch (error) { receipt.transportFailure = true; throw error; }
        } };
        if (scenario.seed.length) {
          const seeded = applyWeeklyPlanningVNextTurn(state, { ...empty(), add: scenario.seed }, {
            expectedRevision: 0, weekStartsOn: clock.weekStartsOn, planningHorizon: { startDate: clock.planningStartDate, endDate: clock.planningEndDate }, defaultPlanningHorizon: clock.defaultPlanningHorizon, acceptedDate: clock.currentDate, turnKey: `seed:${scenario.id}`, conversationId: `synthetic:${scenario.id}`,
            turnId: 'seed', sourceText: 'Synthetic accepted facts for an isolated semantic test',
          });
          if (seeded.status !== 'applied') throw new Error(`Invalid synthetic seed: ${JSON.stringify(seeded)}`);
          state = seeded.state;
        }
        artifact.initialState = structuredClone(state);
        for (const [index, turn] of scenario.turns.entries()) {
          receipts = [];
          const before = structuredClone(state);
          const observation: Record<string, unknown> = { index, userText: turn.text, expected: turn.expected, before, receipts };
          observations.push(observation);
          const projection = projectWeeklyPlanningVNext(state);
          const presentedQuestion = projection.questions[0] ?? null;
          const result = await createWeeklyPlanningVNextProviderInterpreter()({ client, state, projection,
            presentedQuestion, presentedText: presentedQuestion ? presentWeeklyPlanningVNextQuestion(state, presentedQuestion).text : null, userText: turn.text, clock });
          observation.result = result;
          let applyStatus = 'empty';
          if (result.status === 'interpreted') {
            const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
              presented: presentedQuestion ? { questionKey: presentedQuestion.key, graphRevision: projection.graphRevision } : null,
              projection, graph: state.graph, interpreted: result });
            observation.resolved = resolved;
            if (resolved.status === 'represent') {
              failures.push(`turn ${index}: answer did not bind to the presented question`);
              applyStatus = 'represent';
            } else if (resolved.status === 'conflict') {
              failures.push(`turn ${index}: answer and delta conflict: ${JSON.stringify(resolved.errors)}`);
              applyStatus = 'conflict';
            } else if (Object.values(resolved.delta).some(items => items.length)) {
              const applied = applyWeeklyPlanningVNextTurn(state, resolved.delta, { expectedRevision: state.graph.revision,
                weekStartsOn: clock.weekStartsOn, planningHorizon: { startDate: clock.planningStartDate, endDate: clock.planningEndDate }, defaultPlanningHorizon: clock.defaultPlanningHorizon, acceptedDate: clock.currentDate, turnKey: `${scenario.id}:turn:${index}`, conversationId: `synthetic:${scenario.id}`,
                turnId: String(index), sourceText: turn.text });
              applyStatus = applied.status;
              if (applied.status === 'applied' || applied.status === 'noop') state = applied.state;
              else failures.push(`turn ${index}: post-interpretation transaction ${applied.status}`);
            }
          }
          if (result.status === 'failed') failures.push(`turn ${index}: provider ${result.reason}`);
          const oracleFailures = checkVNextProviderScenario(turn.expected, before, state, result);
          failures.push(...oracleFailures.map(failure => `turn ${index}: ${failure}`));
          Object.assign(observation, { applyStatus,
            after: structuredClone(state), projection: projectWeeklyPlanningVNext(state),
            lineages: state.graph.factLifecycles.map(entry => [entry.factId, createVNextLineageResolver(state.graph).lineageOf(entry.factId)]),
            oracleFailures });
        }
        artifact.completed = true;
        expect(failures, JSON.stringify(failures)).toEqual([]);
      } catch (error) {
        artifact.exceptionName = error instanceof Error ? error.name : 'unknown';
        throw error;
      } finally {
        artifact.finalState = state;
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(join(outputDir, `${scenario.id}.json`), JSON.stringify(artifact, null, 2), 'utf8');
      }
    }, Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? 420_000));
  }
});

run('#868-6 compound date scope through the native provider and placement', () => {
  it.each([
    { id: 'compound-date-implicit', text: '明日の13時から15時のゼミを予定に入れて。あと数学の問題集を1時間やりたいので、それも予定を作って', mathDate: '2026-11-03' },
    { id: 'compound-date-shared', text: '明日の予定を作って。13時から15時のゼミを入れて、あと数学の問題集を1時間やりたい', mathDate: '2026-11-03' },
    { id: 'compound-date-independent', text: '明日の13時から15時のゼミを予定に入れて。数学の問題集は今日1時間やりたいので、それも予定を作って', mathDate: '2026-11-02' },
  ])('$id', async ({ id, text, mathDate }) => {
    const clock = { ...defaultClock, currentDate: '2026-11-02' };
    const receipts: Array<{ request: unknown; response?: string; transportFailure?: boolean }> = [];
    const artifact: Record<string, unknown> = { id, syntheticOnly: true, text, clock, expectedMathDate: mathDate, receipts, completed: false };
    let raw: string | null = null;
    let saves = 0;
    try {
      if (requiredEnv('VITE_AI_PROVIDER') !== 'openai') throw new Error('Authorized provider required');
      const actual = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: requiredEnv('VITE_AI_BASE_URL'),
        model: requiredEnv('VITE_AI_MODEL'), apiKey: requiredEnv('VITE_AI_API_KEY'), requestTimeoutMs: 90_000 });
      const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
        const receipt: typeof receipts[number] = { request: structuredClone(request) };
        receipts.push(receipt);
        try { const response = await actual.createChatCompletion(request); receipt.response = response; return response; }
        catch { receipt.transportFailure = true; throw new Error('Synthetic observation transport failed'); }
      } };
      const ports: WeeklyPlanningVNextExperimentalPorts = { client, interpret: createWeeklyPlanningVNextProviderInterpreter(),
        checkpoint: { read: () => raw, write: value => { raw = value; } }, legacyV5Checkpoint: { read: () => null },
        approvalLedger: { read: () => null, write: () => { throw new Error('Observation must never approve'); } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { saves++; throw new Error('Observation must never save'); } },
        calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
        now: () => '2026-11-02T00:00:00.000Z',
        createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '合成の候補説明', rawResponse: '' }) }),
      };
      const result = await submitWeeklyPlanningVNextExperimentalTurn({
        scope: { ownerId: 'synthetic-868', conversationId: id, weekStartDate: '2026-11-02', notBeforeTime: '09:00', clock },
        ports, turnId: 'compound', userText: text, shownRevision: null,
      });
      artifact.result = result;
      artifact.checkpoint = raw ? JSON.parse(raw) : null;
      artifact.saves = saves;
      artifact.completed = true;
      const math = result.draftCandidates?.filter(candidate => candidate.title.includes('数学')) ?? [];
      expect(math.length, 'The explicitly requested study preview must exist').toBeGreaterThan(0);
      expect(math.every(candidate => candidate.date === mathDate), 'The study candidates keep the interpreted day scope').toBe(true);
      expect(result.draftCandidates?.some(candidate => candidate.source === 'fixed_event_registration'
        && candidate.date === '2026-11-03' && candidate.startTime === '13:00' && candidate.endTime === '15:00')).toBe(true);
      expect(saves).toBe(0);
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, `${id}.json`), JSON.stringify(artifact, null, 2), 'utf8');
    }
  }, Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? 420_000));
});
