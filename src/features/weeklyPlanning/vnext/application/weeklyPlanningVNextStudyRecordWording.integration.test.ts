// Argon adoption points and PR #974 comment 6634537603: characterize wording through the real
// application/session/interpreter. New wording requirements stay red; no production fix belongs here.
import { createElement, createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPlanningActualRecordsSection } from '../../../../components/AiPlanningActualRecordsSection';
import { ActualSaveReadbackUnknownError } from '../../../../domain/actualSaveReadback';
import { PlannerMutationScopeExpiredError } from '../../../../lib/plannerMutationScopeExpiredError';
import { formatActualRecordMinutes, sumActualRecordMinutes } from '../../application/weeklyPlanningActualRecords';
import type { UseWeeklyPlanningApplicationInput, WeeklyPlanningApplication } from '../../application/useWeeklyPlanningApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { readAndClassifyActualSave } from '../weeklyPlanningVNextActualSaveReadback';
import { VNEXT_STUDY_RECORD_SAVE_GUIDE } from '../weeklyPlanningVNextStudyRecords';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';

const OWNER = 'study-wording-owner';
const WEEK = '2026-11-02';
const NOW = '2026-11-03T00:00:00.000Z';
const record = (dateExpression: string, subject: string, minutes: number) => ({ dateExpression, subject, minutes });
const WEEK_RECORDS = [record('2026-10-26', '数学', 60), record('2026-10-27', '英語', 45),
  record('2026-10-28', '現代文', 30), record('2026-10-30', '英語', 50),
  record('2026-10-31', '数学', 120), record('2026-11-01', '化学', 90)];
const SEED = '先週は月曜に数学60分、火曜に英語45分、水曜に現代文30分、金曜に英語50分、土曜に数学120分、日曜に化学90分やりました。';
const CONFIRM = 'この内容を学習実績に反映してよいですか？';
const reading = (studyRecords: typeof WEEK_RECORDS = []) => ({ planningIntent: 'discuss', conversationActs: [],
  delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, answer: null,
  studyRecords, studyRecordQuestion: null, studyRestDays: [] });

const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput;
  services: WeeklyPlanningVNextLocalApplicationServices; error: string }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => app, [app]);
  return createElement(AiPlanningActualRecordsSection, { records: app.pendingActualRecords ?? [],
    isSaving: false, disabled: false, error: props.error,
    onSave: () => { void app.approveActualRecords?.().catch(() => undefined); } });
});

function visibleText(node: ReactTestRendererJSON | ReactTestRendererJSON[] | null): string {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  return (node.children ?? []).map(child => typeof child === 'string' ? child : visibleText(child)).join(' ');
}

describe('study record wording: adopted Argon points and provisional-actual UX', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    storage = createMemoryStorageHarness();
    restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restore();
  });

  async function scenario(script: Array<ReturnType<typeof reading> | Error>) {
    let ref = createRef<WeeklyPlanningApplication>();
    const saveActuals = vi.fn<NonNullable<UseWeeklyPlanningApplicationInput['saveWeeklyActualRecords']>>(async () => undefined);
    const savePlan = vi.fn();
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage,
      interpret: () => createWeeklyPlanningVNextProviderInterpreter(), now: () => NOW,
      client: () => ({ async createChatCompletion(request) {
        const prompt = JSON.parse(request.messages[1].content) as { actionId: string;
          applicationDecision?: { actionKind: string; questionCode: string | null; relevantLabels: string[] } };
        if (prompt.applicationDecision) {
          // A real renderer consumes only its application-owned labels; this does not invent a save guide.
          return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
            questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null,
            text: ['確認を続けます。', ...prompt.applicationDecision.relevantLabels].join(' ') });
        }
        const next = script.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error('Synthetic study-record reading exhausted');
        return JSON.stringify(next);
      } }),
      createRenderer: (client, options) => createWeeklyPlanningStableV5DialogueRendererCore(client, options) };
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: savePlan, saveWeeklyActualRecords: saveActuals };
    const mount = async (nextServices = services, error = '') => {
      if (renderer) await act(async () => renderer!.unmount());
      ref = createRef<WeeklyPlanningApplication>();
      await act(async () => { renderer = create(createElement(Harness, { ref, input, services: nextServices, error })); });
    };
    await mount();
    const app = () => ref.current!;
    const lastReply = () => app().state.messages.filter(message => message.role === 'assistant').slice(-1)[0]!.content;
    const turn = async (text: string, allowFailure = false) => {
      await act(async () => {
        const pending = app().submitTurn(text);
        if (allowFailure) await pending.catch(() => undefined);
        else await pending;
      });
      return lastReply();
    };
    const seed = async () => {
      const reply = await turn(SEED);
      expect(app().pendingActualRecords).toHaveLength(6);
      expect(sumActualRecordMinutes(app().pendingActualRecords!)).toBe(395);
      expect(saveActuals).not.toHaveBeenCalled();
      expect(savePlan).not.toHaveBeenCalled();
      return reply;
    };
    const readback = async (kind: 'not_saved' | 'unknown') => {
      saveActuals.mockRejectedValueOnce(new PlannerMutationScopeExpiredError());
      await act(async () => { await expect(app().approveActualRecords!()).rejects.toThrow(PlannerMutationScopeExpiredError); });
      const readActualSave: NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']> = vi.fn((ownerId, attempted) =>
        readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => {
          if (kind === 'unknown') throw new ActualSaveReadbackUnknownError('unavailable');
          return { fromCache: false, hasPendingWrites: false, records: [] };
        } }));
      // Error is a public input of the real confirmation component. No page-level error persistence is assumed.
      await mount({ ...services, readActualSave }, '保存結果を確認できませんでした。');
      await act(async () => { await vi.waitFor(() => expect(app().state.messages.some(message =>
        message.id.includes(':actual-save-readback:'))).toBe(true)); });
      expect(readActualSave).toHaveBeenCalledOnce();
      expect(saveActuals).toHaveBeenCalledOnce();
      expect(app().pendingActualRecords).toHaveLength(6);
      return lastReply();
    };
    return { app, turn, seed, readback, saveActuals, savePlan, lastReply,
      checkpoint: () => createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK,
        storage: storage.storage, chatId: app().chat.index.activeChatId }).readCheckpoint()!.vnext };
  }

  it('1: a chat save request retains six pending records, saves nothing, and names the explicit UI action', async () => {
    const h = await scenario([reading(WEEK_RECORDS), reading()]);
    await h.seed();
    const before = structuredClone(h.app().pendingActualRecords);
    const reply = await h.turn('保存して');
    expect(h.saveActuals).not.toHaveBeenCalled();
    expect(h.savePlan).not.toHaveBeenCalled();
    expect(h.app().pendingActualRecords).toEqual(before);
    expect(reply).not.toContain('保存しました');
    expect(reply).toContain(VNEXT_STUDY_RECORD_SAVE_GUIDE);
  });

  it('2: P1 failure with pending actuals uses actual-record wording (new wording requirement)', async () => {
    const h = await scenario([reading(WEEK_RECORDS), new Error('Synthetic study-record provider unavailable')]);
    await h.seed();
    const before = structuredClone(h.app().pendingActualRecords);
    const reply = await h.turn('火曜の実績を直したい', true);
    expect(h.checkpoint().failureRecovery).toEqual({ reason: 'provider_error', consecutiveCount: 1 });
    expect(h.app().pendingActualRecords).toEqual(before);
    expect(h.saveActuals).not.toHaveBeenCalled();
    expect.soft(reply).not.toContain('計画');
    expect.soft(reply).not.toContain('仮案');
  });

  it('3: a pending Tuesday correction explains both 45 and 50 minutes without adding or saving', async () => {
    const h = await scenario([reading(WEEK_RECORDS), reading([record('2026-10-27', '英語', 50)])]);
    await h.seed();
    const before = structuredClone(h.app().pendingActualRecords!);
    const reply = await h.turn('火曜の英語は45分ではなく50分でした');
    expect(h.app().pendingActualRecords).toEqual(before.map(row => row.occurrenceDate === '2026-10-27' ? { ...row, minutes: 50 } : row));
    expect(sumActualRecordMinutes(h.app().pendingActualRecords!)).toBe(400);
    expect(h.saveActuals).not.toHaveBeenCalled();
    expect.soft(reply).toContain(formatActualRecordMinutes(45));
    expect.soft(reply).toContain(formatActualRecordMinutes(50));
  });

  it('4: not_saved names the same retry action as the actual error-state confirmation button', async () => {
    const h = await scenario([reading(WEEK_RECORDS)]);
    await h.seed();
    const reply = await h.readback('not_saved');
    expect(reply).toContain('サーバー上に保存されていません');
    const buttonLabel = renderer!.root.findByType('button').children.join('');
    expect(buttonLabel).toBe('実績の保存を再試行');
    expect(reply).toContain(buttonLabel);
  });

  it('5: an unknown save result explains how the user can check it without an automatic resend', async () => {
    const h = await scenario([reading(WEEK_RECORDS)]);
    await h.seed();
    const reply = await h.readback('unknown');
    expect(reply).toContain('確認待ち');
    expect(['再読み込み', '再読込', '開き直'].some(action => reply.includes(action)), reply).toBe(true);
  });

  it('6: conversation and confirmation show provisional actuals and ask for reflection; chat yes cannot save', async () => {
    const h = await scenario([reading(WEEK_RECORDS), reading()]);
    const reply = await h.seed();
    const confirmation = visibleText(renderer!.toJSON());
    expect.soft(reply, 'conversation').toContain('仮実績');
    expect.soft(reply, 'conversation').toContain(CONFIRM);
    expect.soft(confirmation, 'confirmation UI').toContain('仮実績');
    expect.soft(confirmation, 'confirmation UI').toContain(CONFIRM);
    await h.turn('はい');
    expect(h.saveActuals).not.toHaveBeenCalled();
    expect(h.app().pendingActualRecords).toHaveLength(6);
    await act(async () => { renderer!.root.findByType('button').props.onClick(); });
    expect(h.saveActuals).toHaveBeenCalledOnce();
    expect(h.saveActuals.mock.calls[0][0]).toBe(OWNER);
    expect(h.saveActuals.mock.calls[0][1]).toHaveLength(6);
  });
});
