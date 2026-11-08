import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { getFirebaseAuth } from '../../../lib/firebaseClient';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../types';
import type { IsolatedWeeklyPlanningTurnInput, IsolatedWeeklyPlanningTurnResult } from './weeklyPlanningIsolatedTurn';
import type { DurableTurnResult } from '../../../../workers/ai-proxy/src/durableTurns/durableTurnJob';
import { WeeklyPlanningDurableAccessDeniedError, WeeklyPlanningDurableOwnerMismatchError } from './weeklyPlanningDurableAccessDeniedError';

export const durableWeeklyPlanningEnabled = () => import.meta.env.VITE_DURABLE_WEEKLY_TURNS === 'enabled';
const RETENTION_MS = 24 * 60 * 60_000;
/** Every interval the client itself defines; tests advance past these rather than guess. */
export const DURABLE_CLIENT_TIMING = {
  retentionMs: RETENTION_MS,
  pollBaseMs: 2000,
  pollMaxMs: 10_000,
  /** A healthy queued/running turn is polled at the base interval this many times (about 30 s, past the slowest observed turn) before backing off. */
  steadyPolls: 15,
  requestTimeoutMs: 20_000,
  reconcileWindowMs: 5 * 60_000,
} as const;
/** Wait after a healthy queued/running answer. Failure retries keep their own growing backoff. */
export const healthyPollDelayMs = (polls: number) => polls < DURABLE_CLIENT_TIMING.steadyPolls
  ? DURABLE_CLIENT_TIMING.pollBaseMs
  : Math.min(DURABLE_CLIENT_TIMING.pollMaxMs, DURABLE_CLIENT_TIMING.pollBaseMs + (polls - DURABLE_CLIENT_TIMING.steadyPolls + 1) * 1000);
/** Each core owns its receipt: a build that predates a core never sees (or resumes) that core's receipt. */
export type DurableReceiptCore = 'stable_v5' | 'vnext';
export const durableReceiptKey = (ownerId: string, core: DurableReceiptCore = 'stable_v5') =>
  `studyplanner.durableWeeklyTurn.${core === 'vnext' ? 'vnext.' : ''}v1:${encodeURIComponent(ownerId)}`;
const receiptCore = (value: { payload: DurableWeeklyTurnPayload }): DurableReceiptCore =>
  (value.payload as { core?: unknown }).core === 'vnext' ? 'vnext' : 'stable_v5';
/** Core-neutral identity; each executor validates its own payload at admission. */
export interface DurableWeeklyTurnPayload {
  input: { userId: string; conversationId?: string; traceRequestId?: string };
}
export interface DurableWeeklyTurnReceipt<Payload extends DurableWeeklyTurnPayload = IsolatedWeeklyPlanningTurnInput> {
  version: 1;
  cancelRequested?: boolean;
  ownerId: string;
  snapshot: PlanningState;
  pending: WeeklyPlanningPendingTurn;
  payload: Payload;
}
export interface DurableTurnClientPorts {
  fetch: typeof fetch;
  token(ownerId: string): Promise<string>;
  endpoint: string;
  now(): number;
  wait(ms: number): Promise<void>;
}

export function readDurableWeeklyTurnReceipt<Payload extends DurableWeeklyTurnPayload = IsolatedWeeklyPlanningTurnInput>(ownerId: string, core: DurableReceiptCore = 'stable_v5'): DurableWeeklyTurnReceipt<Payload> | null {
  if (typeof window === 'undefined') return null;
  const key = durableReceiptKey(ownerId, core);
  try {
    const raw = window.localStorage.getItem(key); if (!raw) return null;
    if (new TextEncoder().encode(raw).length > 4 * 1024 * 1024) return null;
    const value = JSON.parse(raw) as DurableWeeklyTurnReceipt<Payload>;
    if (value.version !== 1 || value.ownerId !== ownerId || value.payload?.input?.userId !== ownerId
      || value.pending?.conversationId !== value.payload.input.conversationId
      || value.pending?.requestId !== value.payload.input.traceRequestId
      || value.snapshot?.revision !== value.pending.baseRevision
      || !Number.isFinite(Date.parse(value.pending.startedAt))) return null;
    if (Date.parse(value.pending.startedAt) + RETENTION_MS <= Date.now()) {
      window.localStorage.removeItem(key); return null;
    }
    return value;
  } catch { return null; }
}
export function saveDurableWeeklyTurnReceipt(value: DurableWeeklyTurnReceipt<DurableWeeklyTurnPayload>): void {
  if (typeof window === 'undefined') throw new Error('会話の復帰情報を保存できませんでした。');
  const raw = JSON.stringify(value);
  const key = durableReceiptKey(value.ownerId, receiptCore(value));
  window.localStorage.setItem(key, raw);
  if (window.localStorage.getItem(key) !== raw) throw new Error('会話の復帰情報を保存できませんでした。');
}
export function clearDurableWeeklyTurnReceipt(ownerId: string, requestId: string, core: DurableReceiptCore = 'stable_v5'): void {
  const current = readDurableWeeklyTurnReceipt(ownerId, core);
  if (current?.pending.requestId === requestId) window.localStorage.removeItem(durableReceiptKey(ownerId, core));
}
function defaultPorts(): DurableTurnClientPorts {
  const base = getCloudflareAiProxyUrl().replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
  return {
    fetch: (...args) => fetch(...args), endpoint: `${base}/weekly-planning/turns`, now: Date.now,
    token: async (ownerId) => {
      const user = getFirebaseAuth()?.currentUser;
      if (!user || user.uid !== ownerId) throw new WeeklyPlanningDurableOwnerMismatchError();
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
export async function executeDurableWeeklyTurn<Result extends IsolatedWeeklyPlanningTurnResult = IsolatedWeeklyPlanningTurnResult>(
  receipt: DurableWeeklyTurnReceipt<DurableWeeklyTurnPayload>,
  options: { resumeOnly?: boolean; isCurrent?: () => boolean; ports?: DurableTurnClientPorts } = {},
): Promise<Result> {
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
  let healthyPolls = 0;
  while (ports.now() < deadline) {
    if (options.isCurrent?.() === false) throw new Error('会話が切り替わったため、古い返信の反映を止めました。');
    const token = await ports.token(receipt.ownerId);
    let response: Response;
    try {
      const submit = maySubmit && !needsReconcile;
      response = await ports.fetch(submit ? ports.endpoint : url, {
        method: submit ? 'POST' : 'GET', signal: AbortSignal.timeout(DURABLE_CLIENT_TIMING.requestTimeoutMs),
        headers: { Authorization: `Bearer ${token}`, ...(submit ? { 'Content-Type': 'application/json' } : {}) },
        ...(submit ? { body: JSON.stringify({ conversationId: identity.conversationId, requestId: identity.requestId,
          baseRevision: identity.baseRevision, startedAt: identity.startedAt, payload: receipt.payload }) } : {}),
      });
      if (response.status === 404) {
        if (needsReconcile && maySubmit && ports.now() - identity.startedAt < DURABLE_CLIENT_TIMING.reconcileWindowMs) {
          needsReconcile = false; await ports.wait(DURABLE_CLIENT_TIMING.pollBaseMs); continue;
        }
        throw new Error('保存された返信を確認できませんでした。新しいAI処理は開始していません。');
      }
      if (response.status === 401 || response.status === 403) throw new WeeklyPlanningDurableAccessDeniedError(response.status);
      if ((response.status >= 400 && response.status < 500) || response.status === 503) throw new Error('返信の継続を受け付けられませんでした。会話を開き直してください。');
      if (!response.ok) { needsReconcile = true; await ports.wait(Math.min(DURABLE_CLIENT_TIMING.pollMaxMs, DURABLE_CLIENT_TIMING.pollBaseMs + attempts++ * 1000)); continue; }
      const state = await response.json() as DurableTurnResult;
      if (!state || typeof state !== 'object') throw new Error('保存された返信の形式を確認できませんでした。');
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
        const result = JSON.parse(state.result) as Result;
        if (!result || typeof result !== 'object' || !result.result || typeof result.result.message !== 'string' || !Array.isArray(result.result.draftCandidates)
          || !Array.isArray(result.stagedContextFacts) || typeof result.observedDate !== 'string') throw new Error('保存された返信の形式を確認できませんでした。');
        return result;
      }
      if (state.status === 'failed' || state.status === 'expired') throw new Error('返信の生成が中断しました。自動でAIを再実行していません。');
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) throw error;
      needsReconcile = true;
    }
    // needsReconcile is false only after a healthy queued/running answer; every failure path keeps the old backoff.
    const delay = needsReconcile
      ? Math.min(DURABLE_CLIENT_TIMING.pollMaxMs, DURABLE_CLIENT_TIMING.pollBaseMs + attempts * 1000)
      : healthyPollDelayMs(healthyPolls++);
    attempts++;
    await ports.wait(delay);
  }
  throw new Error('返信の保存期限が切れました。');
}

/** Explicit user cancellation only; browser suspension/visibility never invokes this. */
export async function cancelDurableWeeklyTurn(ownerId: string, requestId: string, ports = defaultPorts(), core: DurableReceiptCore = 'stable_v5'): Promise<boolean> {
  const receipt = readDurableWeeklyTurnReceipt<DurableWeeklyTurnPayload>(ownerId, core);
  if (!receipt || receipt.pending.requestId !== requestId) return false;
  // Keep an unacknowledged cancellation on disk so reload never resumes it as work.
  try { saveDurableWeeklyTurnReceipt({ ...receipt, cancelRequested: true }); } catch { /* Still try to stop server dispatch. */ }
  try {
    const token = await ports.token(ownerId);
    const query = new URLSearchParams({ conversationId: receipt.pending.conversationId, requestId,
      baseRevision: String(receipt.pending.baseRevision), startedAt: String(Date.parse(receipt.pending.startedAt)) });
    const response = await ports.fetch(`${ports.endpoint}?${query}`, { method: 'DELETE', keepalive: true,
      signal: AbortSignal.timeout(DURABLE_CLIENT_TIMING.requestTimeoutMs), headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const state = await response.json() as DurableTurnResult;
    if (!['completed', 'failed', 'expired'].includes(state.status)
      || state.identity?.ownerId !== ownerId || state.identity.requestId !== requestId
      || state.identity.conversationId !== receipt.pending.conversationId
      || state.identity.baseRevision !== receipt.pending.baseRevision) return false;
    clearDurableWeeklyTurnReceipt(ownerId, requestId, core); return true;
  } catch { return false; }
}
