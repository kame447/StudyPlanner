import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { getFirebaseAuth } from '../../../lib/firebaseClient';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../types';
import type { IsolatedWeeklyPlanningTurnInput, IsolatedWeeklyPlanningTurnResult } from './weeklyPlanningIsolatedTurn';
import type { DurableTurnResult } from '../../../../workers/ai-proxy/src/durableTurns/durableTurnJob';

export const durableWeeklyPlanningEnabled = () => import.meta.env.VITE_DURABLE_WEEKLY_TURNS === 'enabled';
const RETENTION_MS = 24 * 60 * 60_000;
const key = (ownerId: string) => `studyplanner.durableWeeklyTurn.v1:${encodeURIComponent(ownerId)}`;
export interface DurableWeeklyTurnReceipt {
  version: 1;
  cancelRequested?: boolean;
  ownerId: string;
  snapshot: PlanningState;
  pending: WeeklyPlanningPendingTurn;
  payload: IsolatedWeeklyPlanningTurnInput;
}
export interface DurableTurnClientPorts {
  fetch: typeof fetch;
  token(ownerId: string): Promise<string>;
  endpoint: string;
  now(): number;
  wait(ms: number): Promise<void>;
}

export function readDurableWeeklyTurnReceipt(ownerId: string): DurableWeeklyTurnReceipt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(ownerId)); if (!raw) return null;
    if (new TextEncoder().encode(raw).length > 4 * 1024 * 1024) return null;
    const value = JSON.parse(raw) as DurableWeeklyTurnReceipt;
    if (value.version !== 1 || value.ownerId !== ownerId || value.payload?.input?.userId !== ownerId
      || value.pending?.conversationId !== value.payload.input.conversationId
      || value.pending?.requestId !== value.payload.input.traceRequestId
      || value.snapshot?.revision !== value.pending.baseRevision
      || !Number.isFinite(Date.parse(value.pending.startedAt))) return null;
    if (Date.parse(value.pending.startedAt) + RETENTION_MS <= Date.now()) {
      window.localStorage.removeItem(key(ownerId)); return null;
    }
    return value;
  } catch { return null; }
}
export function saveDurableWeeklyTurnReceipt(value: DurableWeeklyTurnReceipt): void {
  if (typeof window === 'undefined') throw new Error('会話の復帰情報を保存できませんでした。');
  const raw = JSON.stringify(value);
  window.localStorage.setItem(key(value.ownerId), raw);
  if (window.localStorage.getItem(key(value.ownerId)) !== raw) throw new Error('会話の復帰情報を保存できませんでした。');
}
export function clearDurableWeeklyTurnReceipt(ownerId: string, requestId: string): void {
  const current = readDurableWeeklyTurnReceipt(ownerId);
  if (current?.pending.requestId === requestId) window.localStorage.removeItem(key(ownerId));
}
function defaultPorts(): DurableTurnClientPorts {
  const base = getCloudflareAiProxyUrl().replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
  return {
    fetch, endpoint: `${base}/weekly-planning/turns`, now: Date.now,
    token: async (ownerId) => {
      const user = getFirebaseAuth()?.currentUser;
      if (!user || user.uid !== ownerId) throw new Error('会話の所有者が変わりました。');
      return user.getIdToken();
    },
    wait: (ms) => new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => { clearTimeout(timer); window.removeEventListener('pageshow', done); window.removeEventListener('focus', done); document.removeEventListener('visibilitychange', visible); resolve(); };
      const visible = () => { if (document.visibilityState === 'visible') done(); };
      timer = setTimeout(done, ms);
      window.addEventListener('pageshow', done); window.addEventListener('focus', done); document.addEventListener('visibilitychange', visible);
    }),
  };
}

/** Resume is GET-only. An uncertain POST is reconciled by reading its same identity first. */
export async function executeDurableWeeklyTurn(
  receipt: DurableWeeklyTurnReceipt,
  options: { resumeOnly?: boolean; isCurrent?: () => boolean; ports?: DurableTurnClientPorts } = {},
): Promise<IsolatedWeeklyPlanningTurnResult> {
  if (receipt.cancelRequested) throw new Error('この返信はキャンセルされています。');
  const ports = options.ports ?? defaultPorts();
  const identity = { ownerId: receipt.ownerId, conversationId: receipt.pending.conversationId,
    requestId: receipt.pending.requestId, baseRevision: receipt.pending.baseRevision,
    startedAt: Date.parse(receipt.pending.startedAt) };
  const query = new URLSearchParams({ conversationId: identity.conversationId, requestId: identity.requestId });
  const url = `${ports.endpoint}?${query}`;
  const deadline = identity.startedAt + RETENTION_MS;
  let maySubmit = !options.resumeOnly;
  let needsReconcile = false;
  let attempts = 0;
  while (ports.now() < deadline) {
    if (options.isCurrent?.() === false) throw new Error('会話が切り替わったため、古い返信の反映を止めました。');
    const token = await ports.token(receipt.ownerId);
    let response: Response;
    try {
      const submit = maySubmit && !needsReconcile;
      response = await ports.fetch(submit ? ports.endpoint : url, {
        method: submit ? 'POST' : 'GET', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, ...(submit ? { 'Content-Type': 'application/json' } : {}) },
        ...(submit ? { body: JSON.stringify({ conversationId: identity.conversationId, requestId: identity.requestId,
          baseRevision: identity.baseRevision, startedAt: identity.startedAt, payload: receipt.payload }) } : {}),
      });
      if (response.status === 404) {
        if (needsReconcile && maySubmit && ports.now() - identity.startedAt < 5 * 60_000) {
          needsReconcile = false; await ports.wait(2000); continue;
        }
        throw new Error('保存された返信を確認できませんでした。新しいAI処理は開始していません。');
      }
      if (response.status === 401 || response.status === 403) throw new Error('再ログインして会話を開き直してください。');
      if ((response.status >= 400 && response.status < 500) || response.status === 503) throw new Error('返信の継続を受け付けられませんでした。会話を開き直してください。');
      if (!response.ok) { needsReconcile = true; await ports.wait(Math.min(10_000, 2000 + attempts++ * 1000)); continue; }
      const state = await response.json() as DurableTurnResult;
      if (JSON.stringify(state.identity) !== JSON.stringify(identity)) {
        // Object key order is not protocol identity.
        if (Object.entries(identity).some(([field, value]) => state.identity?.[field as keyof typeof identity] !== value)) throw new Error('保存された返信の識別情報が一致しません。');
      }
      if (!['queued', 'running', 'completed', 'failed', 'expired'].includes(state.status)) {
        throw new Error('保存された返信の状態を確認できませんでした。');
      }
      maySubmit = false; needsReconcile = false;
      if (state.status === 'completed') {
        if (typeof state.result !== 'string') throw new Error('保存された返信の形式を確認できませんでした。');
        const result = JSON.parse(state.result) as IsolatedWeeklyPlanningTurnResult;
        if (!result.result || typeof result.result.message !== 'string' || !Array.isArray(result.result.draftCandidates)
          || !Array.isArray(result.stagedContextFacts) || typeof result.observedDate !== 'string') throw new Error('保存された返信の形式を確認できませんでした。');
        return result;
      }
      if (state.status === 'failed' || state.status === 'expired') throw new Error('返信の生成が中断しました。自動でAIを再実行していません。');
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) throw error;
      needsReconcile = true;
    }
    await ports.wait(Math.min(10_000, 2000 + attempts++ * 1000));
  }
  throw new Error('返信の保存期限が切れました。');
}

/** Explicit user cancellation only; browser suspension/visibility never invokes this. */
export async function cancelDurableWeeklyTurn(ownerId: string, requestId: string, ports = defaultPorts()): Promise<boolean> {
  const receipt = readDurableWeeklyTurnReceipt(ownerId);
  if (!receipt || receipt.pending.requestId !== requestId) return false;
  // Keep an unacknowledged cancellation on disk so reload never resumes it as work.
  try { saveDurableWeeklyTurnReceipt({ ...receipt, cancelRequested: true }); } catch { /* Still try to stop server dispatch. */ }
  try {
    const token = await ports.token(ownerId);
    const query = new URLSearchParams({ conversationId: receipt.pending.conversationId, requestId,
      baseRevision: String(receipt.pending.baseRevision), startedAt: String(Date.parse(receipt.pending.startedAt)) });
    const response = await ports.fetch(`${ports.endpoint}?${query}`, { method: 'DELETE', keepalive: true,
      signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const state = await response.json() as DurableTurnResult;
    if (!['completed', 'failed', 'expired'].includes(state.status)
      || state.identity?.ownerId !== ownerId || state.identity.requestId !== requestId
      || state.identity.conversationId !== receipt.pending.conversationId
      || state.identity.baseRevision !== receipt.pending.baseRevision) return false;
    clearDurableWeeklyTurnReceipt(ownerId, requestId); return true;
  } catch { return false; }
}
