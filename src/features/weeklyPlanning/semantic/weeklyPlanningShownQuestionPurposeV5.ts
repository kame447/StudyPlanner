/**
 * Verified binding of an amount (Issue #488 P3 S3a v2, critics 4240/4247). An amount (a bare role-less budget or a target
 * workload) that answers a pending amount question binds as a plan target only when the question the user was SHOWN is a plan
 * question. The shown assistant text is judged by a focused, typed check (owned by the dialogue side) that sets the purpose for
 * the turn: `plan` holds nothing; `progress`, `other` or an unavailable check keep the amount as a declared, role-unresolved fact
 * (one typed role confirmation; completed and remaining amounts stay). Declarations never unlock a binding; the check runs only
 * on turns that hold no demoting purpose and carry such an amount.
 */
import type {
  ShownQuestionPurposeCheckResultV5,
  ShownQuestionPurposeV5,
} from '../dialogue/weeklyPlanningShownQuestionPurposeCheck';

export type { ShownQuestionPurposeV5 };
export type ShownQuestionPurposeCheckV5 = (questionText: string) => Promise<ShownQuestionPurposeCheckResultV5>;

/** The check never throws into the turn: a failure is `unavailable`. */
export async function runShownQuestionPurposeCheckV5(
  check: ShownQuestionPurposeCheckV5 | undefined,
  questionText: string | null,
): Promise<ShownQuestionPurposeCheckResultV5> {
  if (!check || !questionText) return 'unavailable';
  try {
    return await check(questionText);
  } catch {
    return 'unavailable';
  }
}
