import {
  createWeeklyDraftApprovalOperation,
  executeWeeklyDraftApproval,
  parseWeeklyApprovalLedger,
  serializeWeeklyApprovalLedger,
  validateWeeklyPreviewApproval,
} from '../../planning/weeklyPlanningApproval';
import type { WeeklyDraftApprovalOperation } from '../../planning/weeklyPlanningApprovalTypes';
import { readWeeklyPlanningVNextExperimentalSession, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { vnextPlanningWindowNeedsYearConfirmation } from '../weeklyPlanningVNextPlanningWindowYear';
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';

export type WeeklyPlanningVNextExperimentalApproval =
  | { status: 'rejected'; reason: string }
  | { status: 'executed'; operation: WeeklyDraftApprovalOperation };

/**
 * Saves the shown preview. The existing approval guard checks it against the
 * current revision; the ledger records each block, so a partial save resumes
 * with the same operation and an approved preview is never saved twice.
 * The save boundary: only this function writes plans, and only blocks that were shown. Do not save
 * from a turn or re-schedule here (the user approves what they saw). Tests: integration
 * "asks, binds the answer…saves partially, resumes, and never saves twice", "a correction before
 * approval replaces the shown preview…".
 */
export async function approveWeeklyPlanningVNextExperimentalPreview(params: {
  scope: WeeklyPlanningVNextExperimentalScope;
  ports: WeeklyPlanningVNextExperimentalPorts;
}): Promise<WeeklyPlanningVNextExperimentalApproval> {
  const { scope, ports } = params;
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready' || read.source !== 'vnext' || !read.checkpoint.preview) {
    return { status: 'rejected', reason: 'no-shown-preview' };
  }
  const { preview, state } = read.checkpoint;
  const guard = validateWeeklyPreviewApproval({
    blocks: preview.blocks,
    currentStateRevision: state.graph.revision,
    userId: scope.ownerId,
    proposalRecords: [],
    runtimeSnapshot: { conversationId: scope.conversationId, stateRevision: state.graph.revision, proposalRecords: [] },
  });
  if (!guard.allowed) return { status: 'rejected', reason: guard.attempt.kind };
  // An old shown preview is not proof of the year after a checkpoint reload.
  if (filterActiveWeeklyPlanningFactsV5(state.graph, state.graph.planningWindows).some(vnextPlanningWindowNeedsYearConfirmation)) {
    return { status: 'rejected', reason: 'planning-window-unconfirmed' };
  }

  const ledgerRaw = ports.approvalLedger.read();
  const ledger = ledgerRaw === null ? { operations: [] } : parseWeeklyApprovalLedger(ledgerRaw);
  if (!ledger) return { status: 'rejected', reason: 'approval-ledger-unreadable' };
  const existing = ledger.operations.find((operation) => operation.userId === scope.ownerId
    && operation.previewId === guard.metadata.previewId && operation.previewStateRevision === guard.metadata.stateRevision);
  const operation = await executeWeeklyDraftApproval({
    operation: existing ?? createWeeklyDraftApprovalOperation({
      userId: scope.ownerId, metadata: guard.metadata, blocks: preview.blocks, now: ports.now(),
    }),
    blocks: preview.blocks,
    dependencies: {
      findExistingPlanId: ({ sourceDraftBlockId }) => ports.plans.findExistingPlanId(sourceDraftBlockId),
      saveBlock: ({ block, source }) => ports.plans.saveBlock(block, source.approvalOperationId),
      now: ports.now,
    },
  });
  ports.approvalLedger.write(serializeWeeklyApprovalLedger([
    ...ledger.operations.filter((candidate) => candidate.approvalOperationId !== operation.approvalOperationId),
    operation,
  ]));
  return { status: 'executed', operation };
}
