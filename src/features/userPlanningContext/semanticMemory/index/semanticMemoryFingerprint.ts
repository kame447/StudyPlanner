import type { UserPlanningContextRecordV1 } from '../../userPlanningContextTypes';

/** SHA-256 avoids storing raw account IDs in database/preference names. */
export async function semanticMemoryHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function semanticMemoryEmbeddedText(record: UserPlanningContextRecordV1): string {
  return `${record.label}: ${record.value ?? ''}。${record.sourceText}`.normalize('NFKC').trim();
}

/** Includes provenance/authority as well as embedded fields: any record edit invalidates a vector. */
export function semanticMemoryRecordFingerprint(record: UserPlanningContextRecordV1): Promise<string> {
  return semanticMemoryHash(JSON.stringify([
    record.id, record.ownerId, record.kind, record.label, record.value, record.dateExpression,
    record.observedDate, record.resolvedDate, record.sourceText, record.status,
    record.origin, record.recordedAt, record.sourceConversationId, record.sourceTurnId,
  ]));
}
