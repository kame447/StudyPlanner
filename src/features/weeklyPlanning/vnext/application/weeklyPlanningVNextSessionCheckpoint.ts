// VNext session checkpoint: the Stable V5 storage envelope with a required
// capability and a `vnext` body. The current V5 reader rejects both the unknown
// capability and the unknown key, so it can never misread a VNext checkpoint;
// it routes it to unreadable-storage retention instead. Reading a V5 checkpoint
// with VNext is an explicit, non-destructive migration that bumps the revision.
import { WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningFactGraphV5 } from '../weeklyPlanningVNextV5Boundary';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';
import { SEMANTIC_STUDY_ACTIVITY_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { frozenGroundingRange } from '../../application/weeklyPlanningTemporalContext';
import type { WeeklyPlanningGroundingRecord } from '../../intake/weeklyPlanningIntakeTypes';
import { adaptWeeklyPlanningV5GraphToVNext, type WeeklyPlanningVNextAdapterNote } from '../projection/weeklyPlanningVNextV5Adapter';
import {
  WEEKLY_PLANNING_VNEXT_STATE_VERSION,
  type VNextEffortEstimateFact,
  type WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import type { WeeklyPlanDraftBlock } from '../../types';
import type { WeeklyPlanningVNextPresentedQuestion } from './weeklyPlanningVNextAnswerBinding';
import { VNEXT_RECENT_MESSAGE_LIMIT, type WeeklyPlanningVNextMessage } from './weeklyPlanningVNextDialogue';

export const WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY = 'vnext-conversation-core-v1' as const;
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

/** The preview shown with the latest reply; approval saves exactly these blocks. */
export interface WeeklyPlanningVNextShownPreview {
  previewId: string;
  graphRevision: number;
  blocks: WeeklyPlanDraftBlock[];
}

export interface WeeklyPlanningVNextSessionCheckpoint {
  version: typeof WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION;
  requiredCapabilities: readonly [typeof WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY];
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  vnext: {
    state: WeeklyPlanningVNextState;
    /** The question shown with the latest reply, and that reply's exact text (what the user saw). */
    presentedQuestion: (WeeklyPlanningVNextPresentedQuestion & { shownText: string }) | null;
    preview: WeeklyPlanningVNextShownPreview | null;
    /** The latest messages, for the renderer's conversational context only; never read as facts. */
    messages: WeeklyPlanningVNextMessage[];
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

/**
 * A v1 checkpoint saved before study contexts carried an activity (#926, before 038d95d8) has none on
 * its contexts; that is the same meaning as a migrated V5 context — not stated — so it reads as 'unknown'.
 * Only an absent field is read this way; an invalid value still makes the checkpoint unreadable.
 */
function withStatedActivity(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.graph) || !Array.isArray(value.graph.studyContexts)) return value;
  return { ...value, graph: { ...value.graph, studyContexts: value.graph.studyContexts.map((context) =>
    (isRecord(context) && !('activityKind' in context) ? { ...context, activityKind: 'unknown' } : context)) } };
}

/** A deferral saved before deferrals carried an allocation (#926) let nothing be placed: 'none'. */
function withDeferralAllocation(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.deferrals)) return value;
  return { ...value, deferrals: value.deferrals.map((deferral) =>
    (isRecord(deferral) && !('allocation' in deferral) ? { ...deferral, allocation: 'none' } : deferral)) };
}

function validState(value: unknown, conversationId: string): value is WeeklyPlanningVNextState {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'graph', 'workRelations', 'deferrals'])
    || value.version !== WEEKLY_PLANNING_VNEXT_STATE_VERSION || !isRecord(value.graph)
    || !Array.isArray(value.workRelations) || !Array.isArray(value.deferrals)) return false;
  const graph = value.graph as unknown as WeeklyPlanningVNextState['graph'];
  if (!validateWeeklyPlanningFactGraphValueV5(graph).graph) return false;
  if (!Array.isArray(graph.effortEstimates) || !graph.effortEstimates.every(validEffortExtension)) return false;
  if (!graph.studyContexts.every((context) => (SEMANTIC_STUDY_ACTIVITY_KINDS_V5 as readonly unknown[]).includes(context.activityKind))) return false;
  const sources = [graph.tasks, graph.components, graph.workloads, graph.effortEstimates, graph.temporalConstraints,
    graph.planningWindows, graph.recurrences, graph.taskDateRules, graph.availabilityDeclarations, graph.relations]
    .flat().map((fact) => fact.source.conversationId);
  if (sources.some((id) => id !== conversationId)) return false;
  const relationsOk = value.workRelations.every((relation) => isRecord(relation)
    && (relation.kind === 'same' || relation.kind === 'distinct')
    && Array.isArray(relation.lineageIds) && relation.lineageIds.length === 2
    && relation.lineageIds.every((id) => typeof id === 'string')
    && Number.isInteger(relation.createdRevision));
  const deferralsOk = value.deferrals.every((deferral) => isRecord(deferral)
    && typeof deferral.questionKey === 'string' && Number.isInteger(deferral.createdRevision)
    && (deferral.allocation === 'none' || deferral.allocation === 'provisional_timebox'));
  return relationsOk && deferralsOk;
}

function validPreview(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !hasExactKeys(value, ['previewId', 'graphRevision', 'blocks'])
    || typeof value.previewId !== 'string' || !Number.isInteger(value.graphRevision)
    || !Array.isArray(value.blocks) || value.blocks.length === 0) return false;
  return value.blocks.every((block) => {
    if (!isRecord(block) || typeof block.id !== 'string' || !isRecord(block.behaviorMetadata)) return false;
    const metadata = block.behaviorMetadata.previewMetadata;
    return isRecord(metadata) && metadata.previewId === value.previewId && metadata.stateRevision === value.graphRevision;
  });
}

function validMessages(value: unknown): boolean {
  return Array.isArray(value) && value.length <= VNEXT_RECENT_MESSAGE_LIMIT && value.every((message) => isRecord(message)
    && hasExactKeys(message, ['role', 'content']) && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string');
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
      || !isRecord(value.vnext) || !hasExactKeys(value.vnext, ['state', 'presentedQuestion', 'preview', 'messages'])) return null;
    const state = withDeferralAllocation(withStatedActivity(value.vnext.state));
    if (!validState(state, value.conversationId) || !validPreview(value.vnext.preview)
      || !validMessages(value.vnext.messages)) return null;
    const presented = value.vnext.presentedQuestion;
    if (presented !== null && !(isRecord(presented) && hasExactKeys(presented, ['questionKey', 'graphRevision', 'shownText'])
      && typeof presented.questionKey === 'string' && Number.isInteger(presented.graphRevision)
      && typeof presented.shownText === 'string')) return null;
    return { ...value, vnext: { ...value.vnext, state } } as unknown as WeeklyPlanningVNextSessionCheckpoint;
  } catch {
    return null;
  }
}

/**
 * Converts a saved Stable V5 graph to VNext state without touching the input.
 * The revision moves forward by one, so previews and presented questions made
 * against the V5 graph fail the existing revision checks and are made again.
 * A relative planning window whose range V5 accepted (its grounding record) is
 * stored with that range, as VNext stores a window when it is stated, so it does
 * not move on a later day; without a record it stays as V5 would read it.
 */
export function migrateWeeklyPlanningV5GraphToVNextSession(
  v5Graph: WeeklyPlanningFactGraphV5,
  groundingRecords: readonly WeeklyPlanningGroundingRecord[] = [],
): {
  state: WeeklyPlanningVNextState;
  notes: WeeklyPlanningVNextAdapterNote[];
} {
  const { state, notes } = adaptWeeklyPlanningV5GraphToVNext(v5Graph);
  const planningWindows = state.graph.planningWindows.map((window) => {
    const frozen = window.start === null && window.end === null
      ? frozenGroundingRange({ windowId: window.id, groundingRecords }) : null;
    return frozen ? { ...window, kind: 'absolute' as const, value: `${frozen.startDate}/${frozen.endDate}`,
      start: frozen.startDate, end: frozen.endDate } : window;
  });
  return {
    state: { ...state, graph: { ...state.graph, planningWindows, revision: v5Graph.revision + 1 } },
    notes,
  };
}
