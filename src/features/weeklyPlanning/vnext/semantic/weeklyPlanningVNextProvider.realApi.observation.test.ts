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

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const run = shouldRun ? describe : describe.skip;
const outputDir = join(process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/weekly-planning-real-api', 'vnext-provider');
const defaultClock = { weekStartsOn: 'monday' as const, currentDate: '2026-10-30', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
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
            expectedRevision: 0, weekStartsOn: clock.weekStartsOn, planningHorizon: { startDate: clock.planningStartDate, endDate: clock.planningEndDate }, acceptedDate: clock.currentDate, turnKey: `seed:${scenario.id}`, conversationId: `synthetic:${scenario.id}`,
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
                weekStartsOn: clock.weekStartsOn, planningHorizon: { startDate: clock.planningStartDate, endDate: clock.planningEndDate }, acceptedDate: clock.currentDate, turnKey: `${scenario.id}:turn:${index}`, conversationId: `synthetic:${scenario.id}`,
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
