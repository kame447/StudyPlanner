// Review and withdrawal of the stored advice (#246 slice 3), and what the UI shows of it. A review is the user's own
// explicit action on the one active proposal: adopting it records the decision and nothing else. It is not a fact,
// not a plan input and not a save; promotion into planning is a later slice.
import type { ConsultationSessionState, ReviewDecision } from '../../consultation/contracts';
import { applyReviewDecision } from '../../consultation/state';
import { withdrawProposalsDerivedFrom } from '../../consultation/storage';
import { serializeWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { readWeeklyPlanningVNextExperimentalSession } from './weeklyPlanningVNextSessionRead';
import type { WeeklyPlanningVNextExperimentalPorts, WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

type Scope = Pick<WeeklyPlanningVNextExperimentalScope, 'ownerId' | 'weekStartDate' | 'conversationId'>;
type Ports = Pick<WeeklyPlanningVNextExperimentalPorts, 'checkpoint' | 'legacyV5Checkpoint' | 'now'>;

export { projectAdviceView as projectWeeklyPlanningVNextAdvice, type AdviceView as WeeklyPlanningVNextAdviceView } from '../../consultation/adviceView';

export interface WeeklyPlanningVNextAdviceReviewRequest {
  adviceId: string;
  adviceRevision: number;
  /** The consultation revision the user was shown; a newer one rejects the review. */
  consultationRevision: number;
  action: 'approve' | 'dismiss';
  /** Absent adopts or declines the whole proposal; set for one option. */
  optionIndex?: number;
}

export type WeeklyPlanningVNextAdviceReviewResult =
  | { status: 'reviewed'; consultation: ConsultationSessionState }
  | { status: 'rejected'; reason: string }
  | { status: 'unreadable' };

function write(scope: Scope, ports: Ports, read: Extract<ReturnType<typeof readWeeklyPlanningVNextExperimentalSession>, { status: 'ready' }>,
  consultation: ConsultationSessionState): boolean {
  const raw = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId,
    vnext: { ...read.checkpoint, consultation }, savedAt: ports.now() });
  if (raw === null) return false;
  ports.checkpoint.write(raw);
  return true;
}

/** One checkpoint write from a fresh read; nothing is written when the review is stale, already decided or not adoptable. */
export function reviewWeeklyPlanningVNextAdvice(scope: Scope, ports: Ports, request: WeeklyPlanningVNextAdviceReviewRequest): WeeklyPlanningVNextAdviceReviewResult {
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready') return { status: 'unreadable' };
  const consultation = read.checkpoint.consultation;
  if (!consultation) return { status: 'rejected', reason: 'no_consultation' };
  const stamp = ports.now().replace(/\D/g, '').slice(0, 40);
  const decision: ReviewDecision = { decisionId: `decision-${stamp}-${consultation.revision}`, consultationId: consultation.consultationId,
    targetAdviceId: request.adviceId, expectedAdviceRevision: request.adviceRevision, expectedConsultationRevision: request.consultationRevision,
    targetScope: request.optionIndex === undefined ? { kind: 'proposal' } : { kind: 'option', optionIndex: request.optionIndex },
    action: request.action, feedback: null, sourceTurnId: 'ui-review', decidedAt: ports.now() };
  const result = applyReviewDecision(consultation, { ownerId: scope.ownerId, conversationId: scope.conversationId, decision });
  if (!result.accepted) return { status: 'rejected', reason: result.reason };
  return write(scope, ports, read, result.state) ? { status: 'reviewed', consultation: result.state } : { status: 'unreadable' };
}

/** A forgotten memory withdraws the advice written from it: its words go, its identity and any decision stay. Returns whether it wrote. */
export function withdrawWeeklyPlanningVNextAdviceForRecords(scope: Scope, ports: Ports, recordIds: ReadonlySet<string>): boolean {
  if (recordIds.size === 0) return false;
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready' || !read.checkpoint.consultation) return false;
  const withdrawn = withdrawProposalsDerivedFrom(read.checkpoint.consultation, recordIds, ports.now());
  return withdrawn.changed && write(scope, ports, read, withdrawn.state);
}
