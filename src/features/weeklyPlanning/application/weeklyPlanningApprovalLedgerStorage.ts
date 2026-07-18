import {
  parseWeeklyApprovalLedger,
  serializeWeeklyApprovalLedger,
} from '../planning/weeklyPlanningApproval';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';

const LEGACY_WEEKLY_APPROVAL_LEDGER_KEY = 'studyplanner-weekly-approval-ledger-v1';

function getUserLedgerKey(userId: string): string {
  return `studyplanner-weekly-approval-ledger-v2.${encodeURIComponent(userId)}`;
}

function parseOperations(value: string | null): WeeklyDraftApprovalOperation[] {
  return value ? parseWeeklyApprovalLedger(value)?.operations ?? [] : [];
}

export function loadWeeklyPlanningApprovalOperations(
  userId: string,
): WeeklyDraftApprovalOperation[] {
  if (typeof window === 'undefined' || !userId.trim()) return [];
  const userKey = getUserLedgerKey(userId);

  try {
    const userValue = window.localStorage.getItem(userKey);
    if (userValue !== null) {
      return parseOperations(userValue).filter((operation) => operation.userId === userId);
    }

    const legacyOperations = parseOperations(
      window.localStorage.getItem(LEGACY_WEEKLY_APPROVAL_LEDGER_KEY),
    );
    const owned = legacyOperations.filter((operation) => operation.userId === userId);
    const remaining = legacyOperations.filter((operation) => operation.userId !== userId);

    if (owned.length > 0) {
      window.localStorage.setItem(userKey, serializeWeeklyApprovalLedger(owned));
    }
    if (remaining.length > 0) {
      window.localStorage.setItem(
        LEGACY_WEEKLY_APPROVAL_LEDGER_KEY,
        serializeWeeklyApprovalLedger(remaining),
      );
    } else {
      window.localStorage.removeItem(LEGACY_WEEKLY_APPROVAL_LEDGER_KEY);
    }
    return owned;
  } catch {
    window.localStorage.removeItem(userKey);
    return [];
  }
}

export function saveWeeklyPlanningApprovalOperations(
  userId: string,
  operations: readonly WeeklyDraftApprovalOperation[],
): void {
  if (typeof window === 'undefined' || !userId.trim()) return;
  const userKey = getUserLedgerKey(userId);
  const owned = operations.filter((operation) => operation.userId === userId);

  try {
    if (owned.length === 0) {
      window.localStorage.removeItem(userKey);
      return;
    }
    window.localStorage.setItem(
      userKey,
      serializeWeeklyApprovalLedger(owned),
    );
  } catch {
    // localStorage is best effort; the in-memory ledger remains authoritative.
  }
}
