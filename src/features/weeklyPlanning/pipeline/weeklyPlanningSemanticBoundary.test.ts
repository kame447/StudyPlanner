import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from './weeklyPlanningIntakePipeline';

function source(relativeUrl: string): string {
  return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), 'utf8');
}

const STATIC_IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function resolveRelativeModule(importer: string, specifier: string): string | undefined {
  const target = resolve(dirname(importer), specifier);
  const candidates = extname(target)
    ? [target]
    : [
        `${target}.ts`,
        `${target}.tsx`,
        resolve(target, 'index.ts'),
        resolve(target, 'index.tsx'),
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

function productionDependencyGraph(entryRelativeUrl: string): string[] {
  const entry = fileURLToPath(new URL(entryRelativeUrl, import.meta.url));
  const pending = [entry];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const content = readFileSync(current, 'utf8');
    const specifiers = [
      ...Array.from(content.matchAll(STATIC_IMPORT_PATTERN), (match) => match[1]),
      ...Array.from(content.matchAll(DYNAMIC_IMPORT_PATTERN), (match) => match[1]),
    ];
    specifiers.forEach((specifier) => {
      const resolved = resolveRelativeModule(current, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    });
  }

  return Array.from(visited);
}

const input = {
  userText: '今日の予定を立てたい',
  planningStartDate: '2026-07-22',
  planningDayCount: 7,
  sessionPolicy: {
    firstDayStartTime: '09:00',
    dayStartTime: '09:00',
    dayEndTime: '22:00',
    breakMinutes: 10,
  },
};

describe('weekly planning semantic ownership boundary', () => {

  it('keeps parser and legacy modules outside the production dependency graph', () => {
    const graph = productionDependencyGraph('../weeklyPlanningTurnExecutor.ts');
    const forbidden = graph.filter((path) => {
      const normalized = path.split('\\').join('/');
      return normalized.includes('/parsing/')
        || /(?:Parsing|Parser|Legacy|\.testSupport)\.(?:ts|tsx)$/.test(normalized);
    });

    expect(forbidden).toEqual([]);
  });

  it('keeps every production entry point on the AI-only interpretation path', () => {
    const executor = source('../weeklyPlanningTurnExecutor.ts');
    const behaviorPipeline = source('./weeklyPlanningBehaviorAwareIntakePipeline.ts');
    const intakePipeline = source('./weeklyPlanningIntakePipeline.ts');
    const withInterpreterBody = intakePipeline.slice(
      intakePipeline.indexOf('export async function runWeeklyPlanningIntakePipelineWithInterpreter'),
    );

    expect(executor).not.toContain('runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(');
    expect(executor).not.toContain("provider !== 'rules'");
    expect(behaviorPipeline).not.toContain('applyDraftGenerationAuthorizationTurn');
    expect(withInterpreterBody).not.toContain('applyWeeklyPlanningUserTurn(');
    expect(withInterpreterBody).not.toContain('applyWeeklyPlanningUserTurnWithDiagnostics');
    expect(withInterpreterBody).not.toContain('parseRequestClarificationCommand');
    expect(withInterpreterBody).not.toContain('runLegacyWeeklyPlanningIntakePipelineForTests(input)');
  });

  it('prevents downstream validators and resolvers from receiving raw user text', () => {
    const validator = source('../intake/weeklyPlanningCandidateValidator.ts');
    const resolver = source('../intake/weeklyPlanningReferenceResolution.ts');
    const interpreterTypes = source('../intake/weeklyPlanningInterpreterTypes.ts');

    expect(validator).not.toContain('normalizeIntakeText');
    expect(validator).not.toContain('parseSmallInteger');
    expect(validator).not.toContain('sourceUserText');
    expect(resolver).not.toContain('userText');
    expect(interpreterTypes).not.toContain('sourceUserText');
  });

  it('fails closed when the AI interpreter is missing', async () => {
    await expect(runWeeklyPlanningIntakePipelineWithInterpreter(input)).rejects.toMatchObject({
      name: 'WeeklyPlanningSemanticInterpreterError',
      code: 'interpreter_unavailable',
    });
  });

  it('fails closed instead of invoking a parser after a provider error', async () => {
    const previousState = createInitialPlanningIntakeState();
    previousState.lastQuestionContext = {
      kind: 'options',
      targetSlot: 'planning_period',
      intent: 'ask_planning_period',
    };
    previousState.questions = ['いつからいつまでの計画にしますか？'];

    const result = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...input,
      previousState,
      interpreter: {
        async interpretUserTurn() {
          throw new Error('provider unavailable');
        },
      },
    });

    expect(result.interpretationSource).toBe('ai_interpreter');
    expect(result.interpretationOutcome).toBe('failed');
    expect(result.stateMutationSource).toBe('none');
    expect(result.interpreterFailure?.category).toBe('provider_error');
    expect(result.state.tasks).toEqual([]);
    expect(result.state.lastQuestionContext).toEqual(previousState.lastQuestionContext);
    expect(result.state.questions).toEqual(previousState.questions);
    expect(result.draftCandidates).toBeNull();
    expect(result.assumedDraft).toBeUndefined();
  });

  it('fails closed on an empty semantic result without generating preview artifacts', async () => {
    const previousState = createInitialPlanningIntakeState();
    previousState.status = 'draft_ready';
    previousState.intent = 'weekly_study_planning';
    previousState.range = {
      startDateTime: '2026-07-22T00:00:00',
      endDateTime: '2026-07-22T24:00:00',
      calendarDayCount: 1,
      sourceText: '今日',
      confidence: 'explicit',
    };
    previousState.tasks = [{
      title: '英単語',
      unit: 'minutes',
      amount: 30,
      rawText: '英単語を30分',
      requiresTimeEstimate: false,
      source: 'command',
    }];
    previousState.fixedEventsDeclaredNone = true;
    previousState.missing = [];
    previousState.shouldCreateDraft = true;
    previousState.draftGenerationIntent = 'user_authorized';
    previousState.draftGenerationAuthorizedAtRevision = 1;

    const result = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...input,
      previousState,
      interpreter: {
        async interpretUserTurn() {
          return { candidates: [], parseRejections: [] };
        },
      },
    });

    expect(result.interpretationOutcome).toBe('failed');
    expect(result.stateMutationSource).toBe('none');
    expect(result.state.draftGenerationIntent).toBe('user_authorized');
    expect(result.draftCandidates).toBeNull();
    expect(result.assumedDraft).toBeUndefined();
  });

  it('preserves state and renders no semantic fallback when all typed candidates are rejected', async () => {
    const previousState = createInitialPlanningIntakeState();
    previousState.lastQuestionContext = {
      kind: 'options',
      targetSlot: 'planning_period',
      intent: 'ask_planning_period',
    };
    previousState.range = {
      startDateTime: '2026-07-22T00:00:00',
      endDateTime: '2026-07-22T24:00:00',
      calendarDayCount: 1,
      sourceText: '今日',
      confidence: 'explicit',
    };

    const result = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...input,
      previousState,
      interpreter: {
        async interpretUserTurn() {
          return {
            candidates: [{
              command: {
                type: 'set_planning_range',
                range: {
                  startDateTime: '2026-07-23T00:00:00',
                  endDateTime: '2026-07-23T24:00:00',
                  confidence: 'explicit',
                },
                sourceText: '明日',
                confidence: 'high',
              },
              origin: 'ai_interpreter',
              needsConfirmation: false,
            }],
            parseRejections: [],
          };
        },
      },
    });

    expect(result.interpretationSource).toBe('ai_interpreter');
    expect(result.interpretationOutcome).toBe('rejected');
    expect(result.stateMutationSource).toBe('none');
    expect(result.state.range).toEqual(previousState.range);
    expect(result.state.lastQuestionContext).toEqual(previousState.lastQuestionContext);
    expect(result.draftCandidates).toBeNull();
    expect(result.assumedDraft).toBeUndefined();
    expect(result.interpreterDiagnostics?.rejected).toHaveLength(1);
  });
});
