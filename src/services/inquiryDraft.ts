import { isInquiryAttachmentList, sameInquiryAttachments, type InquiryAttachment } from '../../shared/inquiryAttachments';
import { createAuthSessionService, type AuthSessionService } from './authSession';
import { submitInquiry, recoverInquiryReceipt } from './inquiryService';
import { uploadInquiryAttachments, type PreparedInquiryAttachment } from './inquiryAttachmentService';
import { validateInquirySubmission, type InquirySubmission } from '../features/support/inquiry';

const STORAGE_KEY = 'laplance.inquiry-receipt.v1';
interface ReceiptMarker { userId: string; receipt: string; attachments?: InquiryAttachment[]; complete: boolean }
type Phase = 'editing' | 'restore-input' | 'sending' | 'failed' | 'recovering' | 'recovery-failed' | 'uploading' | 'upload-failed' | 'needs-files' | 'sent';
export interface InquiryDraftSnapshot {
  resolved: boolean; userId: string | null; body: string; photos: PreparedInquiryAttachment[];
  phase: Phase; restoringReceipt?: boolean; submission?: InquirySubmission; marker?: ReceiptMarker; error: string;
}
const initial = (): InquiryDraftSnapshot => ({ resolved: false, userId: null, body: '', photos: [], phase: 'editing', error: '' });
const SERVER_SNAPSHOT = initial();
function storage(): Storage | undefined { try { return globalThis.sessionStorage; } catch { return undefined; } }
function readMarker(): ReceiptMarker | undefined {
  try {
    const value = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null') as ReceiptMarker | null;
    if (value && typeof value.userId === 'string' && /^[a-zA-Z0-9_-]{20,80}$/.test(value.receipt)
      && typeof value.complete === 'boolean' && (value.attachments === undefined || isInquiryAttachmentList(value.attachments))) return value;
  } catch { /* Unavailable storage must not prevent text inquiries. */ }
  return undefined;
}
function writeMarker(marker?: ReceiptMarker) {
  try { if (marker) storage()?.setItem(STORAGE_KEY, JSON.stringify(marker)); else storage()?.removeItem(STORAGE_KEY); } catch { /* Memory still protects same-document retries. */ }
}

/** One owner-scoped in-memory draft per auth session. Only receipt metadata survives reload. */
export class InquiryDraft {
  private value = initial();
  private listeners = new Set<() => void>();
  private generation = 0;
  private recoveringGeneration: number | null = null;
  private unsubscribe: () => void;
  constructor(readonly auth: AuthSessionService) {
    this.unsubscribe = auth.available ? auth.subscribe((user) => {
      const userId = user?.id ?? null;
      if (this.value.resolved && this.value.userId === userId) return;
      const first = !this.value.resolved;
      this.generation += 1;
      const marker = first ? readMarker() : undefined;
      this.value = { ...initial(), resolved: true, userId };
      if (marker && marker.userId === userId) {
        this.value = { ...this.value, marker, phase: 'recovering' };
        void this.recover();
      } else writeMarker();
      this.emit();
    }) : () => {};
    if (!auth.available) this.value = { ...this.value, resolved: true };
  }
  dispose() {
    this.unsubscribe(); this.generation += 1; this.value = initial(); this.listeners.clear();
    drafts.delete(this.auth);
    if (defaultAuth === this.auth) defaultAuth = undefined;
  }
  getSnapshot = () => this.value;
  // Static rendering never includes an in-memory user's private draft.
  getServerSnapshot = () => SERVER_SNAPSHOT;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach((listener) => listener()); }
  private update(patch: Partial<InquiryDraftSnapshot>) { this.value = { ...this.value, ...patch }; this.emit(); }
  setBody(body: string) { if (['editing', 'restore-input'].includes(this.value.phase)) this.update({ body, error: '' }); }
  setPhotos(photos: PreparedInquiryAttachment[]) { if (this.value.phase === 'editing') this.update({ photos, error: '' }); }
  private current(generation: number, userId: string) { return generation === this.generation && this.value.userId === userId; }
  async send() {
    const { userId, phase, body, photos } = this.value;
    if (!userId || !['editing', 'restore-input', 'failed'].includes(phase)) return;
    let submission: InquirySubmission;
    try { submission = this.value.submission ?? validateInquirySubmission({ requestId: this.value.marker?.receipt ?? crypto.randomUUID(), body, ...(this.value.marker?.attachments ? { attachments: this.value.marker.attachments } : photos.length ? { attachments: photos.map((photo) => photo.descriptor) } : {}) }); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : '内容を確認してください。' }); return; }
    const generation = this.generation;
    const marker = { userId, receipt: submission.requestId, attachments: submission.attachments, complete: false };
    writeMarker(marker);
    this.update({ phase: 'sending', submission, marker, error: '' });
    try {
      const receipt = await submitInquiry(userId, submission);
      if (!this.current(generation, userId)) return;
      const accepted = { ...marker, receipt };
      writeMarker(accepted);
      this.update({ marker: accepted, body: '', submission: undefined });
      await this.upload();
    } catch {
      if (!this.current(generation, userId)) return;
      // A pre-reload attempt can settle after the read. Reconcile its immutable
      // receipt even when the newly re-entered body differs; never create a new ID.
      if (this.value.restoringReceipt) {
        const accepted = await recoverInquiryReceipt(userId, marker.receipt, marker.attachments).catch(() => false);
        if (!this.current(generation, userId)) return;
        if (accepted) { this.update({ body: '', submission: undefined, phase: marker.attachments ? 'needs-files' : 'sent' }); return; }
      }
      if (this.current(generation, userId)) this.update({ phase: 'failed', error: '送信結果を確認できませんでした。同じ受付番号で再試行してください。連続送信は1分に1件までです。' });
    }
  }
  async recover() {
    const { userId, marker } = this.value;
    if (!userId || !marker || !['recovering', 'recovery-failed'].includes(this.value.phase)) return;
    const generation = this.generation;
    if (this.recoveringGeneration === generation) return;
    this.recoveringGeneration = generation;
    this.update({ phase: 'recovering', error: '' });
    try {
      const accepted = await recoverInquiryReceipt(userId, marker.receipt, marker.attachments);
      if (!this.current(generation, userId)) return;
      if (!accepted) { this.update({ phase: 'restore-input', restoringReceipt: true, error: '' }); return; }
      this.update({ phase: marker.complete || !marker.attachments ? 'sent' : 'needs-files' });
    } catch (error) {
      if (this.current(generation, userId)) this.update({ phase: 'recovery-failed', error: error instanceof Error ? error.message : '受付を確認できませんでした。' });
    } finally {
      if (this.recoveringGeneration === generation) this.recoveringGeneration = null;
    }
  }
  restorePhotos(photos: PreparedInquiryAttachment[]) {
    if (!['needs-files', 'upload-failed'].includes(this.value.phase) || !this.value.marker?.attachments) return;
    const remaining = [...this.value.marker.attachments];
    for (const photo of photos) {
      const index = remaining.findIndex((descriptor) => sameInquiryAttachments([descriptor], [photo.descriptor]));
      if (index < 0) { this.update({ error: '受付時と同じ写真を選んでください。別の写真には変更できません。' }); return; }
      remaining.splice(index, 1);
    }
    const unordered = [...photos];
    const ordered = this.value.marker.attachments.flatMap((descriptor) => {
      const index = unordered.findIndex((photo) => sameInquiryAttachments([descriptor], [photo.descriptor]));
      return index < 0 ? [] : [unordered.splice(index, 1)[0]];
    });
    this.update({ photos: ordered, error: '', phase: remaining.length ? 'needs-files' : 'upload-failed' });
  }
  async upload() {
    const { userId, marker, photos } = this.value;
    if (!userId || !marker || !['sending', 'upload-failed', 'needs-files'].includes(this.value.phase)) return;
    const generation = this.generation;
    if (marker.attachments && !sameInquiryAttachments(marker.attachments, photos.map((photo) => photo.descriptor))) { this.update({ phase: 'needs-files' }); return; }
    this.update({ phase: 'uploading', error: '' });
    try {
      if (photos.length) await uploadInquiryAttachments(userId, marker.receipt, photos);
      if (!this.current(generation, userId)) return;
      const complete = { ...marker, complete: true }; writeMarker(complete);
      this.update({ phase: 'sent', photos: [], marker: complete });
    } catch {
      if (this.current(generation, userId)) this.update({ phase: 'upload-failed', error: '本文は受け付けましたが、写真の送信を確認できませんでした。本文を送り直さず、写真だけ再試行できます。' });
    }
  }
  startAnother() {
    if (this.value.phase !== 'sent') return;
    writeMarker(); this.generation += 1;
    this.value = { ...initial(), resolved: true, userId: this.value.userId }; this.emit();
  }
}
let defaultAuth: AuthSessionService | undefined;
const drafts = new WeakMap<AuthSessionService, InquiryDraft>();
export function getInquiryDraft(injectedAuth?: AuthSessionService): InquiryDraft {
  const auth = injectedAuth ?? (defaultAuth ??= createAuthSessionService());
  let draft = drafts.get(auth);
  if (!draft) { draft = new InquiryDraft(auth); drafts.set(auth, draft); }
  return draft;
}
