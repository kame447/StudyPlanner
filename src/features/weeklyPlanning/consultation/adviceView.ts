// What a conversation shows of the latest stored advice (#246 slice 3). Typed state only, never prose. Lives with the
// consultation contracts so the UI can name it without importing from the VNext composition.
import type { ConsultationSessionState } from './contracts';
import { isAdviceReviewable } from './state';

export interface AdviceView {
  status: 'reviewable' | 'approved' | 'withdrawn';
  adviceId: string;
  adviceRevision: number;
  consultationRevision: number;
  optionTitles: readonly string[];
}

export function projectAdviceView(consultation: ConsultationSessionState | undefined): AdviceView | null {
  if (!consultation || consultation.lifecycle !== 'active' || consultation.activeAdviceId === null || consultation.activeAdviceRevision === null) return null;
  const leaf = consultation.proposals.find(proposal => proposal.adviceId === consultation.activeAdviceId
    && proposal.revision === consultation.activeAdviceRevision);
  if (!leaf) return null;
  const base = { adviceId: leaf.adviceId, adviceRevision: leaf.revision, consultationRevision: consultation.revision,
    optionTitles: leaf.answer.options.map(option => option.title) };
  if (leaf.withdrawnAt) return { ...base, status: 'withdrawn', optionTitles: [] };
  if (isAdviceReviewable(consultation, leaf.adviceId, leaf.revision)) return { ...base, status: 'reviewable' };
  return consultation.reviewDecisions.some(decision => decision.targetAdviceId === leaf.adviceId && decision.action === 'approve')
    ? { ...base, status: 'approved' } : null;
}
