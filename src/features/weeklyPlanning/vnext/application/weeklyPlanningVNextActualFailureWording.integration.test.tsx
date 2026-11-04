// #974: a retained actual confirmation list must not be called a plan or preview in failure notices.
// Exercise the real VNext session/controller; only provider and durable HTTP I/O are synthetic.
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { sumActualRecordMinutes } from '../../application/weeklyPlanningActualRecords';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import * as firebase from '../../../../lib/firebaseClient';
import * as aiConfig from '../../../../lib/aiConfig';
import * as durableClient from '../../application/weeklyPlanningDurableTurnClient';

const OWNER = 'wording-owner';
const WEEK = '2026-11-02';
const NOW = '2026-11-03T00:00:00.000Z';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const RECORDS = [
  { dateExpression: '2026-10-26', subject: '数学', minutes: 60 },
  { dateExpression: '2026-10-27', subject: '英語', minutes: 45 },
  { dateExpression: '2026-10-28', subject: '現代文', minutes: 30 },
  { dateExpression: '2026-10-30', subject: '英語', minutes: 50 },
  { dateExpression: '2026-10-31', subject: '数学', minutes: 120 },
  { dateExpression: '2026-11-01', subject: '化学', minutes: 90 },
];
const PLAN = [{ kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'minutes', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'remaining',
    amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => app, [app]);
  return null;
});
type Channel = 'p1' | 'worker' | 'owner' | 401 | 403;
const retainedActuals = (preview: boolean) => (preview
  ? '仮実績の確認リストと表示中の仮案は保持しています。'
  : '仮実績の確認リストは保持しています。') + '今回の入力は保存していません。';
const expectedReply = (actual: boolean, channel: Channel, preview = false) => {
  if (channel === 'p1') return actual
    ? `AIへの接続でエラーが起きました。今回の入力は反映していません。${retainedActuals(preview)}復旧後にもう一度送ってください。`
    : 'AIへの接続でエラーが起きました。今回の内容は計画に反映していません。表示済みの予定案は保持しています。復旧後にもう一度送ってください。';
  if (channel === 'worker') return actual
    ? `今回の返信を確認できませんでした。今回の入力は反映していません。${retainedActuals(preview)}接続が復旧したら、この会話で相談を続けられます。`
    : '今回の返信を確認できませんでした。今回の入力は計画に反映していません。表示中の仮案は保持しています。計画は保存していません。接続が復旧したら、この会話で相談を続けられます。';
  if (channel === 'owner') return actual
    ? `ログイン状態が変わったため、今回の入力は反映していません。${retainedActuals(preview)}同じアカウントで再ログインした後、この会話で相談を続けられます。`
    : 'ログイン状態が変わったため、今回の入力は保存も承認もされていません。同じアカウントで再ログインした後、この会話で相談を続けられます。';
  const reason = channel === 401 ? '認証を確認できませんでした' : 'この会話への権限を確認できませんでした';
  return actual
    ? `${reason}。今回の入力は反映していません。${retainedActuals(preview)}再ログインして権限を確認した後、この会話で相談を続けられます。`
    : `${reason}。今回の入力は保存も承認もされていません。再ログインして権限を確認した後、この会話で相談を続けられます。`;
};

it('keeps six tentative actuals and uses record wording for failures, while preserving every plan-only notice', async () => {
  for (const context of ['actual', 'plan', 'mixed'] as const) for (const channel of ['p1', 'worker', 'owner', 401, 403] as const) {
    const actual = context !== 'plan';
    const preview = context !== 'actual';
    const memory = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(memory.storage);
    let renderer: ReactTestRenderer | undefined;
    try {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', channel === 'p1' ? 'disabled' : 'enabled');
      expect(durableClient.durableWeeklyPlanningEnabled(), `${channel}: deployment route`).toBe(channel !== 'p1');
      vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
      const seedLocal = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
      const seedPorts: WeeklyPlanningVNextExperimentalPorts = { checkpoint: seedLocal.checkpoint, legacyV5Checkpoint: { read: () => null },
        interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { createChatCompletion: async () => JSON.stringify({
          planningIntent: preview ? 'create_plan' : 'discuss', conversationActs: [], answer: null,
          delta: { ...EMPTY, add: preview ? PLAN : [] }, studyRecords: actual ? RECORDS : [], studyRecordQuestion: null,
        }) }, approvalLedger: { read: () => null, write: () => { throw new Error('No approval in this test.'); } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('No seed save.'); } },
        calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => NOW,
        createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '合成の返信', rawResponse: '' }) }) };
      await submitWeeklyPlanningVNextExperimentalTurn({ scope: { ownerId: OWNER, weekStartDate: WEEK, conversationId: 'wording-conversation',
        notBeforeTime: '09:00', clock: { currentDate: '2026-11-03', weekStartsOn: 'monday', timeZone: 'Asia/Tokyo',
          planningStartDate: WEEK, planningEndDate: '2026-11-08' } }, ports: seedPorts,
        userText: context === 'mixed' ? '先週の勉強を記録し、今週の数学を60分で予定を作ってください。'
          : actual ? '先週の勉強を記録したいです。' : '数学を60分、この条件で予定を作ってください。', turnId: 'seed', shownRevision: null });
      const provider = vi.fn(async () => { throw new Error('synthetic private provider outage'); });
      const durableTransport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe('https://wording.fixture.test/weekly-planning/turns');
        expect(init?.method).toBe('POST');
        return Response.json({ error: 'synthetic private durable refusal' }, { status: channel === 'worker' ? 503 : Number(channel) });
      });
      const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).startsWith('https://wording.fixture.test/observability/')) return Response.json({ ok: true });
        return durableTransport(url, init);
      });
      vi.stubGlobal('fetch', transport);
      vi.spyOn(firebase, 'getFirebaseAuth').mockReturnValue({ currentUser: {
        uid: channel === 'owner' ? 'other-owner' : OWNER, getIdToken: async () => 'synthetic-token' } } as never);
      vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://wording.fixture.test');
      const saveActual = vi.fn(async () => {});
      const savePlan = vi.fn<UseWeeklyPlanningApplicationInput['saveWeeklyApprovedPlan']>(async () => { throw new Error('No plan save is authorized.'); });
      const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
        plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
        saveWeeklyApprovedPlan: savePlan, saveWeeklyActualRecords: saveActual };
      const services: WeeklyPlanningVNextLocalApplicationServices = { storage: memory.storage, client: () => ({ createChatCompletion: provider }),
        interpret: () => createWeeklyPlanningVNextProviderInterpreter(), now: () => NOW,
        // This is deliberately unverified, so the real P1 system notice owns the failure wording.
        createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '合成の未検証返信', rawResponse: '' }) }) };
      const ref = createRef<WeeklyPlanningApplication>();
      await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
      const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage,
        chatId: ref.current!.chat.index.activeChatId });
      const before = structuredClone(local.readCheckpoint()!.vnext);
      const pending = ref.current!.pendingActualRecords!;
      if (actual) {
        expect(pending).toHaveLength(6);
        expect(sumActualRecordMinutes(pending)).toBe(395);
        expect(before.actualRecords?.every(record => record.status === 'pending')).toBe(true);
      }
      if (preview) expect(before.preview).not.toBeNull();

      let accepted: boolean | undefined;
      const attemptedText = context === 'actual' ? '火曜日の英語は50分でした。' : '数学を90分に変えてください。';
      await act(async () => { accepted = (await ref.current!.submitTurn(attemptedText)).accepted; });
      // All handled failures accept a conversation reply; none applies the failed input.
      expect(accepted).toBe(true);
      const messages = ref.current!.state.messages;
      const reply = messages[messages.length - 1].content;
      // Keep the original exact wording checks alongside the local owner guard and repeated P1.
      expect.soft(reply, `${context} / ${channel}`).toBe(expectedReply(actual, channel, preview));
      if (actual && !preview) {
        expect.soft(reply, `${channel}: never call actuals a plan`).not.toContain('計画');
        expect.soft(reply, `${channel}: never call actuals a preview`).not.toContain('仮案');
      }
      expect(ref.current!.pendingActualRecords).toEqual(pending);
      const after = local.readCheckpoint()!.vnext;
      expect(after.actualRecords).toEqual(before.actualRecords);
      expect(after.preview).toEqual(before.preview);
      expect(after.state).toEqual(before.state);
      expect(ref.current!.state.pendingTurn).toBeUndefined();
      expect(saveActual).not.toHaveBeenCalled();
      expect(savePlan).not.toHaveBeenCalled();
      expect(provider).toHaveBeenCalledTimes(channel === 'p1' ? 1 : 0);
      expect(durableTransport).toHaveBeenCalledTimes(channel === 'p1' || channel === 'owner' ? 0 : 1);
      if (channel === 'p1') {
        await act(async () => { await ref.current!.submitTurn(attemptedText); });
        const repeated = ref.current!.state.messages;
        expect(repeated[repeated.length - 1].content).toBe(actual
          ? `AIへの接続でエラーが起きました。続けて失敗しています。今回の入力は反映していません。${retainedActuals(preview)}仮実績の確認リストを見直すか、復旧後に今回の入力を再送できます。`
          : 'AIへの接続でエラーが起きました。続けて失敗しています。今回の内容は計画に反映していません。表示済みの予定案は保持しています。予定案を確認するか、復旧後に変更を再送できます。');
        expect(ref.current!.pendingActualRecords).toEqual(pending);
        expect(local.readCheckpoint()!.vnext.actualRecords).toEqual(before.actualRecords);
        expect(saveActual).not.toHaveBeenCalled();
        expect(savePlan).not.toHaveBeenCalled();
        expect(provider).toHaveBeenCalledTimes(2);
      }
    } finally {
      if (renderer) await act(async () => renderer!.unmount());
      resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore();
      vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  }
});
