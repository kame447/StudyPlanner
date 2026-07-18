import type { WeeklyPlanDraftBlock } from '../types';
import {
  deriveApprovalOperationStatus,
  executeWeeklyDraftApproval,
  type ExecuteWeeklyDraftApprovalDependencies,
} from './weeklyPlanningApproval';
import type {
  WeeklyDraftApprovalItem,
  WeeklyDraftApprovalOperation,
} from './weeklyPlanningApprovalTypes';

const APPROVAL_INTERRUPTED = Symbol('weekly-approval-interrupted');

function cloneOperation(operation: WeeklyDraftApprovalOperation): WeeklyDraftApprovalOperation {
  return {
    ...operation,
    items: operation.items.map((item) => ({ ...item })),
  };
}

function replaceItem(
  operation: WeeklyDraftApprovalOperation,
  updatedItem: WeeklyDraftApprovalItem,
): WeeklyDraftApprovalOperation {
  return {
    ...operation,
    items: operation.items.map((item) =>
      item.sourceDraftBlockId === updatedItem.sourceDraftBlockId
        ? { ...updatedItem }
        : item,
    ),
  };
}

export async function executeInterruptibleWeeklyDraftApproval(params: {
  operation: WeeklyDraftApprovalOperation;
  blocks: readonly WeeklyPlanDraftBlock[];
  dependencies: ExecuteWeeklyDraftApprovalDependencies;
  shouldContinue: () => boolean;
}): Promise<WeeklyDraftApprovalOperation> {
  let operation = cloneOperation(params.operation);
  const blockById = new Map(params.blocks.map((block) => [block.id, block]));

  if (operation.status === 'completed') return operation;

  for (const item of operation.items) {
    if (item.status === 'saved' || item.status === 'skipped_duplicate') continue;
    if (!params.shouldContinue()) break;

    const block = blockById.get(item.sourceDraftBlockId);
    const singleItemOperation: WeeklyDraftApprovalOperation = {
      ...operation,
      status: 'pending',
      completedAt: undefined,
      items: [{ ...item }],
    };

    try {
      const result = await executeWeeklyDraftApproval({
        operation: singleItemOperation,
        blocks: block ? [block] : [],
        dependencies: {
          ...params.dependencies,
          async findExistingPlanId(findParams) {
            const existingPlanId = await params.dependencies.findExistingPlanId(findParams);
            if (!params.shouldContinue()) throw APPROVAL_INTERRUPTED;
            return existingPlanId;
          },
        },
      });
      operation = replaceItem(operation, result.items[0]);
    } catch (error) {
      if (error === APPROVAL_INTERRUPTED) break;
      throw error;
    }

    if (!params.shouldContinue()) break;
  }

  const status = deriveApprovalOperationStatus(operation.items);
  operation = { ...operation, status };
  if (status === 'completed') {
    operation.completedAt = params.dependencies.now();
  } else {
    delete operation.completedAt;
  }
  return operation;
}
