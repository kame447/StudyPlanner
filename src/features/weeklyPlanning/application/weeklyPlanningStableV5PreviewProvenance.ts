import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';

type StableV5CandidateWithProvenance = WeeklyDraftCandidate & {
  stableV5Metadata?: {
    runtime: 'stable_v5';
    conversationId?: string;
    [key: string]: unknown;
  };
};

export function bindWeeklyPlanningStableV5PreviewConversation(params: {
  candidates: readonly WeeklyDraftCandidate[];
  conversationId: string;
}): WeeklyDraftCandidate[] {
  return params.candidates.map((candidate) => {
    const metadata = (candidate as StableV5CandidateWithProvenance).stableV5Metadata;
    if (!metadata || metadata.runtime !== 'stable_v5') {
      throw new Error('Stable V5 preview candidate is missing runtime provenance.');
    }
    return {
      ...candidate,
      stableV5Metadata: {
        ...metadata,
        conversationId: params.conversationId,
      },
    } as WeeklyDraftCandidate;
  });
}
