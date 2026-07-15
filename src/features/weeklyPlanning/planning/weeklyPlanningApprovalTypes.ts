export interface PreviewAssumptionDependency {
  proposalId: string;
  targetRef: string;
  proposalCreatedFromStateRevision: number;
}

export type WeeklyPreviewApprovalEligibility =
  | 'eligible'
  | 'blocked_pending_assumption'
  | 'blocked_stale'
  | 'blocked_invalid'
  | 'unsupported';

export interface WeeklyPreviewMetadata {
  previewId: string;
  conversationId?: string;
  stateRevision: number;
  assumptionDependencies: PreviewAssumptionDependency[];
  approvalEligibility: WeeklyPreviewApprovalEligibility;
  stale: boolean;
  authorizedUserId: string;
}

export interface StalePreviewApprovalAttempt {
  kind: 'stale_preview_approval_attempt';
  previewId: string;
  previewStateRevision: number;
  currentStateRevision: number;
  previewStale: true;
}

export interface PendingAssumptionPreviewApprovalAttempt {
  kind: 'pending_assumption_preview_approval_attempt';
  previewId: string;
  previewStateRevision: number;
  pendingProposalIds: string[];
}

export interface InvalidPreviewApprovalAttempt {
  kind: 'invalid_preview_approval_attempt';
  previewId?: string;
  reason: string;
}

export type WeeklyDraftApprovalItemStatus =
  | 'pending'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'skipped_duplicate';

export interface WeeklyDraftApprovalItem {
  sourceDraftBlockId: string;
  status: WeeklyDraftApprovalItemStatus;
  savedPlanId?: string;
  attemptCount: number;
  lastErrorCode?: string;
  updatedAt: string;
}

export type WeeklyDraftApprovalOperationStatus =
  | 'pending'
  | 'partially_saved'
  | 'completed'
  | 'failed';

export interface WeeklyDraftApprovalOperation {
  approvalOperationId: string;
  userId: string;
  previewId: string;
  conversationId?: string;
  previewStateRevision: number;
  startedAt: string;
  completedAt?: string;
  status: WeeklyDraftApprovalOperationStatus;
  items: WeeklyDraftApprovalItem[];
}

export interface ApprovedPlanSource {
  sourceType: 'weekly_draft';
  sourceDraftBlockId: string;
  approvalOperationId: string;
}
