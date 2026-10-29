import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiConfig } from '../../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningStableV5DialogueRenderer } from '../../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import type { WeeklyPlanningStableV5DialogueQuestionIntent } from '../../dialogue/weeklyPlanningStableV5DialogueContracts';
import { questionIntentForStableV5Dialogue } from '../../dialogue/weeklyPlanningStableV5DialogueContext';
import { runIndependentEvalCases } from '../testUtils/issue881IndependentEval';
import {
  questionIntentFromRendererCapture,
  withRendererInputCapture,
} from '../testUtils/issue881IndependentEval';
import { conversation, persistFinalConversationArtifacts, type ConversationObservation } from '../weeklyPlanningIssue156FinalConversation.observation.test';
import type { WeeklyPlanningTurnApplicationServices } from '../../application/weeklyPlanningTurnApplication';
import { recordWeeklyPlanningStableV5DebugTrace } from '../../trace/weeklyPlanningStableV5DebugTrace';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { hasAcceptedBusyInterval, hasTomorrowOnePmDeadline } from '../testUtils/issue881IndependentEval';

const rendererConfig: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'offline-test-model',
  apiKey: 'offline-test-key',
};

function rendererInput(actionId: string, questionIntent?: WeeklyPlanningStableV5DialogueQuestionIntent | null) {
  return {
    actionId,
    currentUserMessage: '夏合宿の発表資料を完成させたいです',
    recentConversation: [],
    planningInformation: null,
    currentTurnGrounding: { mode: 'none' as const, acceptedFacts: [] },
    actionKind: 'question' as const,
    questionCode: 'missing_schedulable_work',
    ...(questionIntent === undefined ? {} : { questionIntent }),
    requiredLabels: [],
    fallbackText: 'どの時間帯なら取り組めそうですか？',
    previewCount: 0,
  };
}

function offlineRendererFor(input: ReturnType<typeof rendererInput>) {
  const client: OpenAiCompatibleClient = {
    async createChatCompletion() {
      return JSON.stringify({
        actionId: input.actionId,
        actionKind: input.actionKind,
        questionCode: input.questionCode,
        groundingAcknowledgement: null,
        text: 'どの時間帯なら取り組めそうですか？',
      });
    },
  };
  return createAiWeeklyPlanningStableV5DialogueRenderer(rendererConfig, client);
}

describe('Issue #881 independent eval case contract', () => {
  it('validates typed temporal gates against recorded artifact fields with positive and negative controls', () => {
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/issue881-temporal-observations.json', import.meta.url), 'utf8')) as {
      A: Partial<WeeklyPlanningFactGraphV5>;
      B: Partial<WeeklyPlanningFactGraphV5>;
    };
    const graph = (fixture: Partial<WeeklyPlanningFactGraphV5>) =>
      Object.assign(createEmptyWeeklyPlanningFactGraphV5(), fixture);

    const busy = graph(recorded.A);
    expect(hasAcceptedBusyInterval(busy)).toBe(true);
    const absoluteBusyDate = structuredClone(busy);
    absoluteBusyDate.availabilityDeclarations[0]!.dateExpression = '2026-08-27';
    expect(hasAcceptedBusyInterval(absoluteBusyDate)).toBe(true);
    const wrongBusyDate = structuredClone(busy);
    wrongBusyDate.availabilityDeclarations[0]!.dateExpression = '2026-08-28';
    expect(hasAcceptedBusyInterval(wrongBusyDate)).toBe(false);
    const inactiveBusy = structuredClone(busy);
    inactiveBusy.factLifecycles[0]!.status = 'removed';
    expect(hasAcceptedBusyInterval(inactiveBusy)).toBe(false);
    const otherSupportedBusyShape = structuredClone(busy);
    const unavailable = otherSupportedBusyShape.availabilityDeclarations[0]!;
    otherSupportedBusyShape.availabilityDeclarations = [];
    const intervalId = 'fixture-fixed-interval';
    otherSupportedBusyShape.factLifecycles = [{ factId: intervalId, status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null }];
    otherSupportedBusyShape.temporalConstraints = [{
      id: intervalId,
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: 'fixed_interval',
      constraintLevel: 'hard',
      dateExpression: unavailable.dateExpression,
      namedTimePeriod: null,
      startTime: unavailable.startTime,
      endTime: unavailable.endTime,
      precision: 'exact',
      source: unavailable.source,
      createdRevision: 3,
    }];
    expect(hasAcceptedBusyInterval(otherSupportedBusyShape)).toBe(true);
    otherSupportedBusyShape.temporalConstraints[0]!.endTime = '19:00';
    expect(hasAcceptedBusyInterval(otherSupportedBusyShape)).toBe(false);

    const deadline = graph(recorded.B);
    expect(hasTomorrowOnePmDeadline(deadline)).toBe(true);
    const absoluteDeadlineDate = structuredClone(deadline);
    absoluteDeadlineDate.temporalConstraints[0]!.dateExpression = '2026-08-27';
    expect(hasTomorrowOnePmDeadline(absoluteDeadlineDate)).toBe(true);
    const wrongDeadlineDate = structuredClone(deadline);
    wrongDeadlineDate.temporalConstraints[0]!.dateExpression = '2026-08-28';
    expect(hasTomorrowOnePmDeadline(wrongDeadlineDate)).toBe(false);
    const wrongEndpoint = structuredClone(deadline);
    wrongEndpoint.temporalConstraints[0]!.endTime = null;
    expect(hasTomorrowOnePmDeadline(wrongEndpoint)).toBe(false);
    const wrongTarget = structuredClone(deadline);
    wrongTarget.temporalConstraints[0]!.targetFactId = 'missing-task';
    expect(hasTomorrowOnePmDeadline(wrongTarget)).toBe(false);
  });

  it('keeps failures in the denominator, runs later cases, and persists in finally', async () => {
    const executed: string[] = [];
    let persisted: Array<{ name: string; status: string; error: string | null }> = [];

    const results = await runIndependentEvalCases({
      cases: [
        {
          name: 'A',
          async run() {
            executed.push('A');
            return { trace: ['validation: invalid date'] };
          },
          validate(value) {
            expect(value.trace).toContain('validation: invalid date');
            throw new Error('raw validation failure');
          },
        },
        {
          name: 'B',
          async run() {
            executed.push('B');
            return { trace: [] };
          },
        },
      ],
      persist(cases) {
        persisted = cases.map(({ name, status, error }) => ({ name, status, error }));
      },
    });

    expect(executed).toEqual(['A', 'B']);
    expect(results.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'A', status: 'failed' },
      { name: 'B', status: 'passed' },
    ]);
    expect(results[0]?.value?.trace).toEqual(['validation: invalid date']);
    expect(results[0]?.error).toContain('raw validation failure');
    expect(persisted).toEqual([
      { name: 'A', status: 'failed', error: 'Error: raw validation failure' },
      { name: 'B', status: 'passed', error: null },
    ]);
  });

  it('records a failed run when an observation cannot be reached', async () => {
    const results = await runIndependentEvalCases({
      cases: [{ name: 'unreached', async run() { throw new Error('provider rejected'); } }],
      persist() {},
    });
    expect(results).toEqual([
      { name: 'unreached', status: 'failed', value: null, error: 'Error: provider rejected' },
    ]);
  });

  it('captures typed intent through the actual renderer call and rejects missing intent', async () => {
    const typedIntent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget: {
        collection: 'tasks',
        fact: { id: 'task-1', title: '夏合宿の発表資料' },
      },
      planningInformation: {
        tasks: [{ id: 'task-1', title: '夏合宿の発表資料' }],
        workloads: [],
      },
    });
    expect(typedIntent).toMatchObject({
      kind: 'schedulable_work_detail',
      mode: 'open_ended_session',
      requestedInformation: ['session_allocation'],
    });

    const captured = new Map<string, unknown>();
    const correctInput = rendererInput('capture-correct', typedIntent);
    const correctRenderer = withRendererInputCapture({
      renderer: offlineRendererFor(correctInput),
      capture(input) { captured.set(input.actionId, input); },
    });
    await correctRenderer.render(correctInput);
    expect(questionIntentFromRendererCapture(captured.get(correctInput.actionId))).toMatchObject({
      kind: 'schedulable_work_detail',
      mode: 'open_ended_session',
      requestedInformation: ['session_allocation'],
    });

    const missingInput = rendererInput('capture-missing');
    const missingRenderer = withRendererInputCapture({
      renderer: offlineRendererFor(missingInput),
      capture(input) { captured.set(input.actionId, input); },
    });
    await missingRenderer.render(missingInput);
    expect(questionIntentFromRendererCapture(captured.get(missingInput.actionId))).toBeNull();
  });

  it('retains normalization failures and counts later turns and conversations in the finally artifact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'issue881-conversation-failure-'));
    try {
      const rejectedGateway: WeeklyPlanningTurnApplicationServices['runtimeGateway'] = {
        async execute(params) {
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: params.pending.requestId,
            stage: 'semantic_validation_result',
            severity: 'error',
            data: { accepted: false, errors: ['fixture normalization rejection: malformed semantic document'] },
          });
          throw new Error('fixture normalization rejection');
        },
      };
      let persisted = false;
      const results = await runIndependentEvalCases<ConversationObservation>({
        cases: ['first', 'later'].map((name) => ({
          name,
          run: () => conversation({
            name,
            ownerId: `issue881-${name}`,
            conversationId: `issue881-${name}`,
            userTurns: ['明日の予定を立てたいです', '後続ターンは未到達です'],
            runtimeGateway: rejectedGateway,
          }),
          validate(observation) {
            expect(observation.turns[0]?.status).toBe('passed');
          },
        })),
        persist(caseResults) {
          persistFinalConversationArtifacts(directory, caseResults, caseResults.flatMap((entry) => entry.value ? [entry.value] : []));
          persisted = true;
        },
      });

      expect(persisted).toBe(true);
      expect(results.map(({ status }) => status)).toEqual(['failed', 'failed']);
      for (const result of results) {
        expect(result.value?.turns).toHaveLength(1);
        expect(result.value?.turns[0]?.status).toBe('failed');
        expect(result.value?.turns[0]?.failure).toContain('fixture normalization rejection');
        expect(result.value?.turns[0]?.validationErrors).toContain(
          'fixture normalization rejection: malformed semantic document',
        );
        expect(result.value?.turns[0]?.debugTrace).toContainEqual(expect.objectContaining({
          stage: 'semantic_validation_result',
        }));
        expect(result.value?.unreachedTurns).toBe(1);
      }
      const artifact = JSON.parse(readFileSync(join(directory, 'final-conversations.json'), 'utf8')) as {
        caseResults: Array<{ status: string }>;
        conversations: Array<{ unreachedTurns: number; turns: Array<{ status: string; validationErrors: string[] }> }>;
      };
      expect(artifact.caseResults.map(({ status }) => status)).toEqual(['failed', 'failed']);
      expect(artifact.conversations.map(({ unreachedTurns, turns }) => ({ unreachedTurns, status: turns[0]?.status }))).toEqual([
        { unreachedTurns: 1, status: 'failed' },
        { unreachedTurns: 1, status: 'failed' },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
