import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { isWeeklyPlanningTraceEnabled } from './weeklyPlanningTraceRepository';
import {
  createWeeklyPlanningTraceApiClient,
  WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  type WeeklyPlanningTraceApiClient,
} from './weeklyPlanningTracePrivacyClient';

export type WeeklyPlanningTraceConsentStatus =
  | 'disabled'
  | 'loading'
  | 'required'
  | 'accepted'
  | 'unavailable';

export interface WeeklyPlanningTracePolicyState {
  status: WeeklyPlanningTraceConsentStatus;
  policyVersion: string;
  acceptedAt: string | null;
  error: string;
  accept(): Promise<boolean>;
  refresh(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '週間計画traceの利用状態を確認できませんでした。';
}

export function useWeeklyPlanningTracePolicy(
  userId: string,
  injectedClient?: WeeklyPlanningTraceApiClient,
): WeeklyPlanningTracePolicyState {
  const defaultClient = useMemo(() => createWeeklyPlanningTraceApiClient(), []);
  const client = injectedClient ?? defaultClient;
  const enabled = isWeeklyPlanningTraceEnabled();
  const proxyConfigured = Boolean(getCloudflareAiProxyUrl().trim());
  const [status, setStatus] = useState<WeeklyPlanningTraceConsentStatus>(
    enabled ? 'loading' : 'disabled',
  );
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus('disabled');
      setAcceptedAt(null);
      setError('');
      return;
    }
    if (!userId.trim() || !proxyConfigured) {
      setStatus('unavailable');
      setAcceptedAt(null);
      setError('週間計画traceのserver設定を確認してください。');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const next = await client.getPolicyStatus();
      const currentAccepted = next.accepted
        && next.policyVersion === WEEKLY_PLANNING_TRACE_POLICY_VERSION;
      setStatus(currentAccepted ? 'accepted' : 'required');
      setAcceptedAt(currentAccepted ? next.acceptedAt : null);
    } catch (caught) {
      setStatus('unavailable');
      setAcceptedAt(null);
      setError(errorMessage(caught));
    }
  }, [client, enabled, proxyConfigured, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const accept = useCallback(async () => {
    if (!enabled) {
      setStatus('disabled');
      return true;
    }
    if (!proxyConfigured || !userId.trim()) {
      setStatus('unavailable');
      setError('週間計画traceのserver設定を確認してください。');
      return false;
    }
    setStatus('loading');
    setError('');
    try {
      const next = await client.acceptPolicy();
      const accepted = next.accepted
        && next.policyVersion === WEEKLY_PLANNING_TRACE_POLICY_VERSION;
      setStatus(accepted ? 'accepted' : 'required');
      setAcceptedAt(accepted ? next.acceptedAt : null);
      if (!accepted) setError('週間計画traceの利用同意を保存できませんでした。');
      return accepted;
    } catch (caught) {
      setStatus('unavailable');
      setAcceptedAt(null);
      setError(errorMessage(caught));
      return false;
    }
  }, [client, enabled, proxyConfigured, userId]);

  return {
    status,
    policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
    acceptedAt,
    error,
    accept,
    refresh,
  };
}
