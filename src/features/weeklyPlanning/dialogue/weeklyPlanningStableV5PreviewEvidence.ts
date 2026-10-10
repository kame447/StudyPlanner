import { measureJsonUtf8Bytes } from '../../../../shared/aiProxyContract';
import { isValidCalendarDate } from '../semantic/weeklyPlanningCalendarResolver';
import { activeWeeklyPlanningFactIdsV5 } from '../semantic/weeklyPlanningFactLifecycleV5';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';
import type { WeeklyPlanningStableV5PreviewEvidence } from './weeklyPlanningStableV5DialogueContracts';

// Bound this new projection, independently of the provider's much larger hard limit.
// Full-set validation and aggregation happen before selecting presentation examples.
const MAX_DETAIL_ROWS = 8;
const MAX_EVIDENCE_BYTES = 4 * 1024;
type AvailableEvidence = Extract<WeeklyPlanningStableV5PreviewEvidence, { status: 'available' }>;

function clockMinutes(time: string, end = false): number | null {
  // Machine HH:mm validation only; never interpretation of user language.
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && !(end && time === '24:00')) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function createWeeklyPlanningStableV5PreviewEvidence(params: {
  result: WeeklyPlanningTurnExecutionResult;
  conversationId: string;
}): WeeklyPlanningStableV5PreviewEvidence {
  const { result, conversationId } = params;
  if (result.preserveExistingPreview) return { status: 'unavailable', reason: 'retained_preview' };
  const graph = result.stableV5Graph;
  if (!graph) return { status: 'unavailable', reason: 'missing_graph' };
  const unavailable = { status: 'unavailable', reason: 'invalid_candidates' } as const;
  if (result.state.status !== 'draft_ready' || result.draftCandidates.length === 0
    || !Number.isSafeInteger(graph.revision) || graph.revision < 0) return unavailable;
  const active = activeWeeklyPlanningFactIdsV5(graph);
  const facts = new Map([
    ...graph.tasks, ...graph.studyContexts, ...graph.components, ...graph.workloads,
    ...graph.effortEstimates, ...graph.temporalConstraints, ...graph.taskDateRules,
    ...graph.planningWindows, ...graph.recurrences, ...graph.relations,
    ...graph.availabilityDeclarations, ...graph.constraintSourceRequests,
  ].filter(fact => active === null || active.has(fact.id)).map(fact => [fact.id, fact]));
  const taskIds = new Set(graph.tasks.filter(task => active === null || active.has(task.id)).map(task => task.id));
  const keys = new Set<string>();
  const rows: AvailableEvidence['details']['candidates'] = [];
  for (const candidate of result.draftCandidates) {
    const metadata = (candidate as typeof candidate & { stableV5Metadata?: WeeklyPlanningStableV5PreviewProvenance })
      .stableV5Metadata;
    const start = clockMinutes(candidate.startTime);
    const end = clockMinutes(candidate.endTime, true);
    if (!metadata || metadata.runtime !== 'stable_v5' || metadata.conversationId !== conversationId
      || metadata.graphRevision !== graph.revision || !taskIds.has(metadata.taskId)
      || facts.get(metadata.taskId)?.source.conversationId !== conversationId
      || !Array.isArray(metadata.sourceFactRefs) || metadata.sourceFactRefs.length === 0
      || !metadata.sourceFactRefs.includes(metadata.taskId)
      || metadata.sourceFactRefs.some(ref => {
        const fact = facts.get(ref);
        return !fact || fact.source.conversationId !== conversationId
          || !Number.isSafeInteger(fact.createdRevision) || fact.createdRevision > graph.revision
          || ('taskId' in fact && fact.taskId !== metadata.taskId)
          || (taskIds.has(ref) && ref !== metadata.taskId);
      })
      || typeof candidate.stableKey !== 'string' || !candidate.stableKey || keys.has(candidate.stableKey)
      || typeof candidate.workItemKey !== 'string' || !candidate.workItemKey
      || typeof candidate.date !== 'string' || !isValidCalendarDate(candidate.date) || start === null || end === null
      || !Number.isFinite(candidate.durationMinutes) || candidate.durationMinutes <= 0
      || candidate.durationMinutes !== end - start || candidate.approvalStatus !== 'unapproved') return unavailable;
    keys.add(candidate.stableKey);
    rows.push({ candidateKey: candidate.stableKey, taskId: metadata.taskId, workItemKey: candidate.workItemKey,
      date: candidate.date, startTime: candidate.startTime, endTime: candidate.endTime,
      durationMinutes: candidate.durationMinutes, approvalStatus: candidate.approvalStatus,
      sourceFactRefs: [...metadata.sourceFactRefs] });
  }
  const total = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  if (!Number.isFinite(total)) return unavailable;
  const evidence: AvailableEvidence = {
    status: 'available', graphRevision: graph.revision, phase: 'generated_preview',
    // No compiler/evaluator fulfillment result crosses this boundary yet.
    constraintEvaluation: 'not_evaluated',
    summary: { scope: 'all_candidates', candidateCount: rows.length, totalDurationMinutes: total,
      minDurationMinutes: rows.reduce((min, row) => Math.min(min, row.durationMinutes), rows[0].durationMinutes),
      maxDurationMinutes: rows.reduce((max, row) => Math.max(max, row.durationMinutes), rows[0].durationMinutes),
      earliestStartTime: rows.reduce((min, row) => row.startTime < min ? row.startTime : min, rows[0].startTime),
      latestEndTime: rows.reduce((max, row) => row.endTime > max ? row.endTime : max, rows[0].endTime) },
    details: { coverage: 'partial', omittedCount: rows.length, candidates: [] },
  };
  // Include the longest blocks first, with a stable tie-break; a late long block must
  // not disappear just because the transport cannot show every candidate.
  rows.sort((a, b) => b.durationMinutes - a.durationMinutes || a.candidateKey.localeCompare(b.candidateKey));
  for (const row of rows) {
    if (evidence.details.candidates.length >= MAX_DETAIL_ROWS) break;
    evidence.details.candidates.push(row);
    if (measureJsonUtf8Bytes(evidence) > MAX_EVIDENCE_BYTES) evidence.details.candidates.pop();
  }
  evidence.details.omittedCount = rows.length - evidence.details.candidates.length;
  evidence.details.coverage = evidence.details.omittedCount === 0 ? 'complete' : 'partial';
  // Final coverage labels can change the serialized size by a byte. Never return
  // an oversized row or silently trim an individual reference to make it fit.
  if (measureJsonUtf8Bytes(evidence) > MAX_EVIDENCE_BYTES) {
    evidence.details.candidates.pop();
    evidence.details.omittedCount = rows.length - evidence.details.candidates.length;
    evidence.details.coverage = 'partial';
  }
  return evidence;
}
