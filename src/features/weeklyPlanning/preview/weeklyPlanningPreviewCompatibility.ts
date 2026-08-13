export interface WeeklyPlanningPreviewCompatibilityMetadata {
  previewId: string;
  conversationId: string;
  stateRevision: number;
  sourceFactRefs: string[];
  reasoningKey: string;
  userId?: string;
}
