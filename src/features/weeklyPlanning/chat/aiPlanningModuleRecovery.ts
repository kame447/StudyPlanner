import type { AiPlanningStarterPromptOption } from '../ui/aiPlanningStarterPrompts';

export interface AiPlanningModuleRecoveryBinding {
  ownerId: string;
  chatId: string;
  conversationId: string;
  weekStartDate: string;
  revision: number;
}
export interface AiPlanningModuleRecoveryDraft {
  text: string;
  selectedStarter: AiPlanningStarterPromptOption | null;
  attachment: File | null;
}
interface EncodedAttachment {
  name: string; type: string; lastModified: number; size: number; base64: string;
}
interface RecoveryCapsule {
  version: 1; token: string; binding: AiPlanningModuleRecoveryBinding;
  createdAt: number; expiresAt: number; text: string;
  selectedStarter: AiPlanningStarterPromptOption | null;
  attachment: EncodedAttachment | null;
}
export const AI_PLANNING_MODULE_RECOVERY_TTL_MS = 30 * 60 * 1000;
export const AI_PLANNING_MODULE_RECOVERY_MAX_BYTES = 2 * 1024 * 1024;
export const AI_PLANNING_MODULE_RECOVERY_KEY = 'studyplanner.aiPlanning.moduleRecovery.v1';
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function boundedString(value: unknown, max = 4000): value is string {
  return typeof value === 'string' && value.length <= max;
}
function validBinding(value: unknown): value is AiPlanningModuleRecoveryBinding {
  return isRecord(value) && ['ownerId', 'chatId', 'conversationId', 'weekStartDate'].every(
    key => boundedString(value[key], 512) && value[key].length > 0,
  ) && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0;
}
export function sameAiPlanningModuleRecoveryBinding(
  left: AiPlanningModuleRecoveryBinding | null,
  right: AiPlanningModuleRecoveryBinding | null,
): boolean {
  return Boolean(left && right && left.ownerId === right.ownerId && left.chatId === right.chatId
    && left.conversationId === right.conversationId && left.weekStartDate === right.weekStartDate
    && left.revision === right.revision);
}
function validStarter(value: unknown): value is AiPlanningStarterPromptOption | null {
  if (value === null) return true;
  if (!isRecord(value) || !['displayText', 'prompt', 'requestText'].every(key => boundedString(value[key]))) return false;
  const target = value.target;
  return target === null || (isRecord(target) && typeof target.kind === 'string' && ['plan', 'todo', 'material'].includes(target.kind)
    && boundedString(target.id, 512) && boundedString(target.label)
    && (target.targetDate === null || boundedString(target.targetDate, 32)));
}
function copyStarter(value: AiPlanningStarterPromptOption | null): AiPlanningStarterPromptOption | null {
  if (!value) return null;
  const target = value.target;
  return { displayText: value.displayText, prompt: value.prompt, requestText: value.requestText,
    target: target ? { kind: target.kind, id: target.id, label: target.label, targetDate: target.targetDate } : null };
}
function parseCapsule(raw: string, now: number): RecoveryCapsule | null {
  if (new TextEncoder().encode(raw).byteLength > AI_PLANNING_MODULE_RECOVERY_MAX_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !boundedString(value.token, 128) || !value.token
      || !validBinding(value.binding) || !boundedString(value.text) || !validStarter(value.selectedStarter)
      || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
      || value.expiresAt !== value.createdAt + AI_PLANNING_MODULE_RECOVERY_TTL_MS
      || now < value.createdAt || now >= Number(value.expiresAt)) return null;
    if (value.attachment !== null) {
      const file = value.attachment;
      if (!isRecord(file) || !boundedString(file.name, 1024) || typeof file.type !== 'string' || !['image/png', 'image/jpeg'].includes(file.type)
        || typeof file.lastModified !== 'number' || !Number.isFinite(file.lastModified)
        || !Number.isSafeInteger(file.size) || Number(file.size) < 0 || typeof file.base64 !== 'string'
        || atob(file.base64).length !== file.size) return null;
    }
    return { ...value, selectedStarter: copyStarter(value.selectedStarter) } as unknown as RecoveryCapsule;
  } catch { return null; }
}
function encodeBytes(bytes: Uint8Array): string {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(raw);
}

/** A small per-tab checkpoint, never uploaded. Oversize/quota failures must not authorize reload. */
export async function saveAiPlanningModuleRecovery(params: {
  storage: RecoveryStorage; binding: AiPlanningModuleRecoveryBinding;
  draft: AiPlanningModuleRecoveryDraft; isCurrent(): boolean; now?: number; token?: string;
}): Promise<boolean> {
  try {
    const { storage, binding, draft } = params;
    const now = params.now ?? Date.now();
    const file = draft.attachment;
    if (!params.isCurrent() || (file && Math.ceil(file.size / 3) * 4 > AI_PLANNING_MODULE_RECOVERY_MAX_BYTES)) return false;
    const attachment = file ? { name: file.name, type: file.type, lastModified: file.lastModified, size: file.size,
      base64: encodeBytes(new Uint8Array(await file.arrayBuffer())) } : null;
    if (!params.isCurrent()) return false;
    const capsule: RecoveryCapsule = { version: 1, token: params.token ?? crypto.randomUUID(), binding: { ...binding },
      createdAt: now, expiresAt: now + AI_PLANNING_MODULE_RECOVERY_TTL_MS,
      text: draft.text, selectedStarter: copyStarter(draft.selectedStarter), attachment };
    const raw = JSON.stringify(capsule);
    if (!parseCapsule(raw, now)) return false;
    storage.setItem(AI_PLANNING_MODULE_RECOVERY_KEY, raw);
    const current = params.isCurrent();
    const readback = storage.getItem(AI_PLANNING_MODULE_RECOVERY_KEY);
    if (!current && readback === raw) storage.removeItem(AI_PLANNING_MODULE_RECOVERY_KEY);
    return current && readback === raw;
  } catch { return false; }
}
export function readAiPlanningModuleRecovery(
  storage: RecoveryStorage, binding: AiPlanningModuleRecoveryBinding, now = Date.now(),
): { token: string; draft: AiPlanningModuleRecoveryDraft } | null {
  try {
    const raw = storage.getItem(AI_PLANNING_MODULE_RECOVERY_KEY);
    if (!raw) return null;
    const capsule = parseCapsule(raw, now);
    if (!capsule) { storage.removeItem(AI_PLANNING_MODULE_RECOVERY_KEY); return null; }
    if (!sameAiPlanningModuleRecoveryBinding(capsule.binding, binding)) return null;
    const encoded = capsule.attachment;
    const file = encoded ? new File([Uint8Array.from(atob(encoded.base64), char => char.charCodeAt(0)).buffer],
      encoded.name, { type: encoded.type, lastModified: encoded.lastModified }) : null;
    return { token: capsule.token, draft: { text: capsule.text, selectedStarter: capsule.selectedStarter, attachment: file } };
  } catch { return null; }
}
/** Acknowledge after the exact draft is rendered, never before restoring it and never by submitting it. */
export function consumeAiPlanningModuleRecovery(
  storage: RecoveryStorage, binding: AiPlanningModuleRecoveryBinding, token: string,
): void {
  try {
    const raw = storage.getItem(AI_PLANNING_MODULE_RECOVERY_KEY);
    const capsule: unknown = raw ? JSON.parse(raw) : null;
    if (isRecord(capsule) && capsule.token === token && validBinding(capsule.binding)
      && sameAiPlanningModuleRecoveryBinding(capsule.binding, binding)) storage.removeItem(AI_PLANNING_MODULE_RECOVERY_KEY);
  } catch { /* A failed acknowledgement never authorizes replay or clears the live composer. */ }
}
