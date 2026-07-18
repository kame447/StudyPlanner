import {
  parseWeeklyApprovalLedger,
  serializeWeeklyApprovalLedger,
} from '../planning/weeklyPlanningApproval';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';

const WEEKLY_APPROVAL_LEDGER_KEY = 'studyplanner-weekly-approval-ledger-v1';

export function loadWeeklyPlanningApprovalOperations(): WeeklyDraftApprovalOperation[] {
  if (typeof window === 'undefined') return [];
  const value = window.localStorage.getItem(WEEKLY_APPROVAL_LEDGER_KEY);
  return value ? parseWeeklyApprovalLedger(value)?.operations ?? [] : [];
}

export function saveWeeklyPlanningApprovalOperations(
  operations: readonly WeeklyDraftApprovalOperation[],
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    WEEKLY_APPROVAL_LEDGER_KEY,
    serializeWeeklyApprovalLedger([...operations]),
  );
}
