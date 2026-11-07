export const CONVERSATION_SYNC_POLICY = '2026-11-07-v1';
export const CONVERSATION_RETENTION_MS = 180 * 86_400_000;
export const conversationSyncPreferenceKey = (ownerId: string) => `studyplanner.conversationSync.v1.${encodeURIComponent(ownerId)}`;
