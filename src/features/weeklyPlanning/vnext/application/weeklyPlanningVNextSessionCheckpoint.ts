// VNext session checkpoint: the Stable V5 storage envelope with a required
// capability and a `vnext` body. The current V5 reader rejects both the unknown
// capability and the unknown key, so it can never misread a VNext checkpoint;
// it routes it to unreadable-storage retention instead. Reading a V5 checkpoint
// with VNext is an explicit, non-destructive migration that bumps the revision.
import { WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningFactGraphV5 } from '../weeklyPlanningVNextV5Boundary';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';
import { adaptWeeklyPlanningV5GraphToVNext, type WeeklyPlanningVNextAdapterNote } from '../projection/weeklyPlanningVNextV5Adapter';
import {
  WEEKLY_PLANNING_VNEXT_STATE_VERSION,
  type VNextEffortEstimateFact,
  type WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import type { WeeklyPlanningVNextPresentedQuestion } from './weeklyPlanningVNextAnswerBinding';

export const WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY = 'vnext-conversation-core-v1' as const;
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

export interface WeeklyPlanningVNextSessionCheckpoint {
  version: typeof WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION;
  requiredCapabilities: readonly [typeof WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY];
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  vnext: {
    state: WeeklyPlanningVNextState;
    presentedQuestion: WeeklyPlanningVNextPresentedQuestion | null;
  };
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validEffortExtension(effort: VNextEffortEstimateFact): boolean {
  const labelOk = effort.unitLabel === null || typeof effort.unitLabel === 'string';
  const binding = effort.workBinding;
  const bindingOk = binding === null || (isRecord(binding)
    && hasExactKeys(binding, ['kind', 'workLineageId', 'boundAmount', 'boundBasisKey'])
    && (binding.kind === 'future_work' || binding.kind === 'observed_pace')
    && typeof binding.workLineageId === 'string'
    && typeof binding.boundAmount === 'number' && Number.isFinite(binding.boundAmount)
    && typeof binding.boundBasisKey === 'string');
  return labelOk && bindingOk && (binding === null || effort.kind === 'total_duration');
}

function validState(value: unknown, conversationId: string): value is WeeklyPlanningVNextState {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'graph', 'workRelations', 'deferrals'])
    || value.version !== WEEKLY_PLANNING_VNEXT_STATE_VERSION || !isRecord(value.graph)
    || !Array.isArray(value.workRelations) || !Array.isArray(value.deferrals)) return false;
  const graph = value.graph as unknown as WeeklyPlanningVNextState['graph'];
  if (!validateWeeklyPlanningFactGraphValueV5(graph).graph) return false;
  if (!Array.isArray(graph.effortEstimates) || !graph.effortEstimates.every(validEffortExtension)) return false;
  const sources = [graph.tasks, graph.components, graph.workloads, graph.effortEstimates, graph.temporalConstraints]
    .flat().map((fact) => fact.source.conversationId);
  if (sources.some((id) => id !== conversationId)) return false;
  const relationsOk = value.workRelations.every((relation) => isRecord(relation)
    && (relation.kind === 'same' || relation.kind === 'distinct')
    && Array.isArray(relation.lineageIds) && relation.lineageIds.length === 2
    && relation.lineageIds.every((id) => typeof id === 'string')
    && Number.isInteger(relation.createdRevision));
  const deferralsOk = value.deferrals.every((deferral) => isRecord(deferral)
    && typeof deferral.questionKey === 'string' && Number.isInteger(deferral.createdRevision));
  return relationsOk && deferralsOk;
}

export function serializeWeeklyPlanningVNextSessionCheckpoint(
  checkpoint: Omit<WeeklyPlanningVNextSessionCheckpoint, 'version' | 'requiredCapabilities'>,
): string | null {
  const envelope: WeeklyPlanningVNextSessionCheckpoint = {
    version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
    requiredCapabilities: [WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY],
    ...checkpoint,
  };
  const raw = JSON.stringify(envelope);
  return new TextEncoder().encode(raw).byteLength <= MAX_CHECKPOINT_BYTES ? raw : null;
}

export function parseWeeklyPlanningVNextSessionCheckpoint(params: {
  raw: string;
  ownerId: string;
  weekStartDate: string;
}): WeeklyPlanningVNextSessionCheckpoint | null {
  if (new TextEncoder().encode(params.raw).byteLength > MAX_CHECKPOINT_BYTES) return null;
  try {
    const value: unknown = JSON.parse(params.raw);
    if (!isRecord(value)
      || !hasExactKeys(value, ['version', 'requiredCapabilities', 'ownerId', 'weekStartDate', 'conversationId', 'vnext', 'savedAt'])
      || value.version !== WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION
      || !Array.isArray(value.requiredCapabilities) || value.requiredCapabilities.length !== 1
      || value.requiredCapabilities[0] !== WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY
      || value.ownerId !== params.ownerId || value.weekStartDate !== params.weekStartDate
      || typeof value.conversationId !== 'string' || !value.conversationId.trim()
      || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))
      || !isRecord(value.vnext) || !hasExactKeys(value.vnext, ['state', 'presentedQuestion'])
      || !validState(value.vnext.state, value.conversationId)) return null;
    const presented = value.vnext.presentedQuestion;
    if (presented !== null && !(isRecord(presented) && hasExactKeys(presented, ['questionKey', 'graphRevision'])
      && typeof presented.questionKey === 'string' && Number.isInteger(presented.graphRevision))) return null;
    return value as unknown as WeeklyPlanningVNextSessionCheckpoint;
  } catch {
    return null;
  }
}

/**
 * Converts a saved Stable V5 graph to VNext state without touching the input.
 * The revision moves forward by one, so previews and presented questions made
 * against the V5 graph fail the existing revision checks and are made again.
 */
export function migrateWeeklyPlanningV5GraphToVNextSession(v5Graph: WeeklyPlanningFactGraphV5): {
  state: WeeklyPlanningVNextState;
  notes: WeeklyPlanningVNextAdapterNote[];
} {
  const { state, notes } = adaptWeeklyPlanningV5GraphToVNext(v5Graph);
  return {
    state: { ...state, graph: { ...state.graph, revision: v5Graph.revision + 1 } },
    notes,
  };
}
