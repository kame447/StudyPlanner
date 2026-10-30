import { projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5 } from '../../semantic/weeklyPlanningSchedulerAvailabilityProjectionV5';
import { resolveWeeklyPlanningDateExpressionsV5 } from '../../semantic/weeklyPlanningResolvedDateExpressionsV5';

type TemporalEvalGraph = {
  factLifecycles: Array<{ factId: string; status: string }>;
  availabilityDeclarations: Parameters<typeof projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5>[0];
  temporalConstraints: Array<{
    id: string; taskId: string; targetFactId: string; kind: string; constraintLevel: string;
    dateExpression: string | null; startTime: string | null; endTime: string | null;
  }>;
  tasks: Array<{ id: string }>;
};

export interface IndependentEvalCase<T> {
  name: string;
  run: () => Promise<T>;
  validate?: (value: T) => void;
}

export interface IndependentEvalCaseResult<T> {
  name: string;
  status: 'passed' | 'failed';
  value: T | null;
  error: string | null;
}

export interface RendererInputWithQuestionIntent {
  actionId: string;
  questionIntent?: unknown;
}

export interface RendererWithCapturedInput<TInput, TResult> {
  render(input: TInput): Promise<TResult>;
}

/** Captures the actual typed renderer input while preserving the renderer call and result. */
export function withRendererInputCapture<
  TInput extends RendererInputWithQuestionIntent,
  TResult,
>(params: {
  renderer: RendererWithCapturedInput<TInput, TResult>;
  capture: (input: TInput) => void;
}): RendererWithCapturedInput<TInput, TResult> {
  return {
    async render(input) {
      params.capture(structuredClone(input));
      return params.renderer.render(input);
    },
  };
}

export function questionIntentFromRendererCapture(input: unknown): unknown | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const intent = (input as RendererInputWithQuestionIntent).questionIntent;
  if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) return null;
  return typeof (intent as { kind?: unknown }).kind === 'string' ? intent : null;
}

function isActive(graph: TemporalEvalGraph, factId: string): boolean {
  return graph.factLifecycles.some((entry) => entry.factId === factId && entry.status === 'active');
}

function resolvesToEvalDay(graph: TemporalEvalGraph, factId: string): boolean {
  const resolved = resolveWeeklyPlanningDateExpressionsV5({
    graph: {
      availabilityDeclarations: graph.availabilityDeclarations,
      temporalConstraints: graph.temporalConstraints,
    },
    currentDate: '2026-08-26',
    weekStartsOn: 'monday',
  });
  return resolved.facts.some((fact) => fact.factId === factId
    && fact.status === 'resolved' && fact.range?.start === '2026-08-27' && fact.range.end === '2026-08-27');
}

export function hasAcceptedBusyInterval(graph: TemporalEvalGraph): boolean {
  const availability = projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5(
    graph.availabilityDeclarations.filter((fact) => isActive(graph, fact.id)),
  );
  const unavailable = availability.some((fact) => fact.kind === 'unavailable'
    && fact.constraintLevel === 'hard' && resolvesToEvalDay(graph, fact.id)
    && fact.startTime === '14:30' && fact.endTime === '20:00');
  const temporal = graph.temporalConstraints.some((fact) => isActive(graph, fact.id)
    && (fact.kind === 'fixed_interval' || fact.kind === 'avoid_window')
    && fact.constraintLevel === 'hard' && resolvesToEvalDay(graph, fact.id)
    && fact.startTime === '14:30' && fact.endTime === '20:00');
  return unavailable || temporal;
}

export function hasTomorrowOnePmDeadline(graph: TemporalEvalGraph): boolean {
  return graph.temporalConstraints.some((fact) => isActive(graph, fact.id)
    && fact.kind === 'deadline' && fact.constraintLevel === 'hard'
    && resolvesToEvalDay(graph, fact.id) && fact.startTime === null && fact.endTime === '13:00'
    && fact.targetFactId === fact.taskId
    && graph.tasks.some((task) => task.id === fact.targetFactId && isActive(graph, task.id)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Runs every case independently and persists the complete denominator in a finally block. */
export async function runIndependentEvalCases<T>(params: {
  cases: readonly IndependentEvalCase<T>[];
  persist: (results: IndependentEvalCaseResult<T>[]) => void | Promise<void>;
}): Promise<IndependentEvalCaseResult<T>[]> {
  const results: IndependentEvalCaseResult<T>[] = [];
  try {
    for (const evalCase of params.cases) {
      let value: T | null = null;
      try {
        value = await evalCase.run();
        evalCase.validate?.(value);
        results.push({ name: evalCase.name, status: 'passed', value, error: null });
      } catch (error) {
        results.push({ name: evalCase.name, status: 'failed', value, error: errorMessage(error) });
      }
    }
  } finally {
    await params.persist(results);
  }
  return results;
}
