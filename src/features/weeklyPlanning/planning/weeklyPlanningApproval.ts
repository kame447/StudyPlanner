import { recordWeeklyPlanningApprovalTrace } from '../trace/weeklyPlanningTraceRuntime';
import type { WeeklyPlanDraftBlock } from '../types';
import type { ApprovedPlanSource, WeeklyDraftApprovalItem, WeeklyDraftApprovalOperation } from './weeklyPlanningApprovalTypes';
import { cloneOperation, deriveApprovalOperationStatus, errorCode } from './weeklyPlanningApprovalCore';

// Pure ledger/guard rules live in Core (shared with the Worker); only execution records the browser trace.
export * from './weeklyPlanningApprovalCore';

export interface ExecuteWeeklyDraftApprovalDependencies {
  findExistingPlanId(params: { userId: string; sourceDraftBlockId: string }): Promise<string | undefined>;
  saveBlock(params: {
    block: WeeklyPlanDraftBlock;
    source: ApprovedPlanSource;
  }): Promise<{ planId: string }>;
  now(): string;
}

export async function executeWeeklyDraftApproval(params: {
  operation: WeeklyDraftApprovalOperation;
  blocks: readonly WeeklyPlanDraftBlock[];
  dependencies: ExecuteWeeklyDraftApprovalDependencies;
}): Promise<WeeklyDraftApprovalOperation> {
  let operation = cloneOperation(params.operation);
  recordWeeklyPlanningApprovalTrace({
    userId: operation.userId,
    phase: 'started',
    payload: {
      approvalOperationId: operation.approvalOperationId,
      previewId: operation.previewId,
      ...(operation.conversationId
        ? { conversationId: operation.conversationId }
        : {}),
      previewStateRevision: operation.previewStateRevision,
      itemCount: operation.items.length,
    },
  });
  if (operation.status === 'completed') {
    recordWeeklyPlanningApprovalTrace({
      userId: operation.userId,
      phase: 'completed',
      payload: operation,
    });
    return operation;
  }
  const blockById = new Map(params.blocks.map((block) => [block.id, block]));

  for (const currentItem of operation.items) {
    if (currentItem.status === 'saved' || currentItem.status === 'skipped_duplicate') continue;
    const block = blockById.get(currentItem.sourceDraftBlockId);
    const itemIndex = operation.items.findIndex((item) => item.sourceDraftBlockId === currentItem.sourceDraftBlockId);
    if (!block || block.userId !== operation.userId) {
      operation.items[itemIndex] = {
        ...currentItem,
        status: 'failed',
        attemptCount: currentItem.attemptCount + 1,
        lastErrorCode: 'missing-or-unauthorized-block',
        updatedAt: params.dependencies.now(),
      };
      continue;
    }

    const existingPlanId = await params.dependencies.findExistingPlanId({
      userId: operation.userId,
      sourceDraftBlockId: block.id,
    });
    if (existingPlanId) {
      operation.items[itemIndex] = {
        ...currentItem,
        status: 'skipped_duplicate',
        savedPlanId: existingPlanId,
        attemptCount: currentItem.attemptCount + 1,
        updatedAt: params.dependencies.now(),
      };
      continue;
    }

    const savingItem: WeeklyDraftApprovalItem = {
      sourceDraftBlockId: currentItem.sourceDraftBlockId,
      status: 'saving',
      attemptCount: currentItem.attemptCount + 1,
      updatedAt: params.dependencies.now(),
    };
    operation.items[itemIndex] = savingItem;
    try {
      const saved = await params.dependencies.saveBlock({
        block,
        source: {
          sourceType: 'weekly_draft',
          sourceDraftBlockId: block.id,
          approvalOperationId: operation.approvalOperationId,
        },
      });
      operation.items[itemIndex] = {
        ...savingItem,
        status: 'saved',
        savedPlanId: saved.planId,
        updatedAt: params.dependencies.now(),
      };
    } catch (error) {
      operation.items[itemIndex] = {
        ...savingItem,
        status: 'failed',
        lastErrorCode: errorCode(error),
        updatedAt: params.dependencies.now(),
      };
    }
  }

  operation = { ...operation, status: deriveApprovalOperationStatus(operation.items) };
  if (operation.status === 'completed') operation.completedAt = params.dependencies.now();
  recordWeeklyPlanningApprovalTrace({
    userId: operation.userId,
    phase: 'completed',
    payload: operation,
    failed: operation.status === 'failed' || operation.status === 'partially_saved',
  });
  return operation;
}
