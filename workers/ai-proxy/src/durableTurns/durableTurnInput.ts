import type { IsolatedWeeklyPlanningTurnInput } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphValidatorV5';
import type { DurableTurnInput } from './durableTurnJob';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { decodeWeeklyPlanningMachineBoundEffortAnswerV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningMachineBoundAnswerV5';

const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every((key) => keys.includes(key));
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));

/** Structural/owner validation only; never interprets the user's words or creates planning truth. */
export function decodeDurableTurnInput(value: unknown, ownerId: string): DurableTurnInput | null {
  if (!record(value) || !only(value, ['conversationId', 'requestId', 'baseRevision', 'startedAt', 'payload'])
    || !text(value.conversationId, 256) || !text(value.requestId, 256)
    || !Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0
    || !Number.isSafeInteger(value.startedAt) || !record(value.payload)) return null;
  const payload = value.payload;
  if (!only(payload, ['input', 'graph', 'userContextRecords', 'weekStartDate']) || !record(payload.input)
    || !date(payload.weekStartDate) || !Array.isArray(payload.userContextRecords) || payload.userContextRecords.length > 200) return null;
  const input = payload.input;
  if (!only(input, ['previousState', 'messages', 'userText', 'supplementalContext', 'selectedStarterTarget',
    'selectedDate', 'userId', 'plans', 'monthEvents', 'actuals', 'studyMaterials', 'scheduleTemplates',
    'timetableTermId', 'timetableTerm', 'timetableTerms', 'conversationId', 'traceRequestId', 'weekStartsOn',
    'requestContext', 'inputStateRevision', 'retainedPreviewCount', 'machineBoundAnswer'])
    || (input.machineBoundAnswer !== undefined && !decodeWeeklyPlanningMachineBoundEffortAnswerV5(input.machineBoundAnswer))
    || input.userId !== ownerId || input.conversationId !== value.conversationId
    || input.traceRequestId !== value.requestId || input.inputStateRevision !== value.baseRevision
    || !text(input.userText, 4000) || !date(input.selectedDate) || !record(input.requestContext)
    || !Array.isArray(input.messages) || input.messages.length > 80
    || input.messages.some((m) => !record(m) || !['user', 'assistant'].includes(String(m.role)) || !text(m.content, 16_000))) return null;
  const context = input.requestContext;
  if (!date(context.currentDate) || !text(context.timeZone, 100)
    || !['monday', 'sunday'].includes(String(context.weekStartsOn))) return null;
  // Replay must use the originally captured clock, never an incomplete context or ambient time.
  try {
    const captured = createWeeklyPlanningTurnRequestContext({ startedAtIso: new Date(value.startedAt as number).toISOString(),
      timeZone: context.timeZone as string, weekStartsOn: context.weekStartsOn as 'monday' | 'sunday' });
    if (Object.entries(captured).some(([key, expected]) => context[key] !== expected)) return null;
  } catch { return null; }
  for (const key of ['plans', 'scheduleTemplates', 'monthEvents', 'actuals', 'studyMaterials', 'timetableTerms']) {
    const list = input[key];
    if (list === undefined && !['plans', 'scheduleTemplates'].includes(key)) continue;
    if (!Array.isArray(list) || list.length > 5000 || list.some((entry) => !record(entry) || entry.userId !== ownerId)) return null;
  }
  if (input.timetableTerm != null && (!record(input.timetableTerm) || input.timetableTerm.userId !== ownerId)) return null;
  if (payload.userContextRecords.some((entry) => !record(entry) || entry.ownerId !== ownerId
    || !text(entry.id, 512) || !text(entry.label, 240) || !text(entry.kind, 100) || !text(entry.status, 100))) return null;
  const graph = validateWeeklyPlanningFactGraphValueV5(payload.graph).graph;
  if (!graph) return null;
  const facts = [graph.planningWindows, graph.tasks, graph.studyContexts, graph.components, graph.workloads,
    graph.effortEstimates, graph.temporalConstraints, graph.taskDateRules, graph.recurrences, graph.relations,
    graph.uncertainties, graph.correctionIntents, graph.decisionIntents, graph.availabilityDeclarations, graph.constraintSourceRequests].flat();
  if (facts.some((fact) => fact.source.conversationId !== value.conversationId)) return null;
  return { ownerId, conversationId: value.conversationId as string, requestId: value.requestId as string,
    baseRevision: value.baseRevision as number, startedAt: value.startedAt as number,
    payload: JSON.stringify(payload as unknown as IsolatedWeeklyPlanningTurnInput) };
}
