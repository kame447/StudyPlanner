// #974-only provisional-actual UX: real application/session/interpreter, scripted provider output.
// P1 and A2 readback do not exist on this base and are tested separately on the Stage A integration.
import { createElement, createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPlanningActualRecordsSection } from '../../../../components/AiPlanningActualRecordsSection';
import { formatActualRecordMinutes, sumActualRecordMinutes } from '../../application/weeklyPlanningActualRecords';
import type { UseWeeklyPlanningApplicationInput, WeeklyPlanningApplication } from '../../application/useWeeklyPlanningApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { VNEXT_STUDY_RECORD_SAVE_GUIDE } from '../weeklyPlanningVNextStudyRecords';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';

const OWNER = '974-wording-owner';
const WEEK = '2026-11-02';
const record = (dateExpression: string, subject: string, minutes: number) => ({ dateExpression, subject, minutes });
const RECORDS = [record('2026-10-26', '数学', 60), record('2026-10-27', '英語', 45),
  record('2026-10-28', '現代文', 30), record('2026-10-30', '英語', 50),
  record('2026-10-31', '数学', 120), record('2026-11-01', '化学', 90)];
const CONFIRM = 'この内容を学習実績に反映してよいですか？';
const reading = (studyRecords = [] as typeof RECORDS) => ({ planningIntent: 'discuss', conversationActs: [],
  delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, answer: null,
  studyRecords, studyRecordQuestion: null, studyRestDays: [] });
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput;
  services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => app, [app]);
  return createElement(AiPlanningActualRecordsSection, { records: app.pendingActualRecords ?? [],
    isSaving: false, disabled: false, error: '', onSave: () => { void app.approveActualRecords?.(); } });
});
function visibleText(node: ReactTestRendererJSON | ReactTestRendererJSON[] | null): string {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  return (node.children ?? []).map(child => typeof child === 'string' ? child : visibleText(child)).join(' ');
}

describe('#974 provisional actual wording without Stage A dependencies', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore();
  });
  async function scenario(script: ReturnType<typeof reading>[]) {
    const ref = createRef<WeeklyPlanningApplication>();
    const saveActuals = vi.fn<NonNullable<UseWeeklyPlanningApplicationInput['saveWeeklyActualRecords']>>(async () => undefined);
    const savePlan = vi.fn();
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage,
      interpret: () => createWeeklyPlanningVNextProviderInterpreter(), now: () => '2026-11-03T00:00:00.000Z',
      client: () => ({ async createChatCompletion(request) {
        const prompt = JSON.parse(request.messages[1].content);
        if (prompt.applicationDecision) return JSON.stringify({ actionId: prompt.actionId,
          actionKind: prompt.applicationDecision.actionKind, questionCode: prompt.applicationDecision.questionCode,
          groundingAcknowledgement: null, text: ['確認を続けます。', ...prompt.applicationDecision.relevantLabels].join(' ') });
        const next = script.shift();
        if (!next) throw new Error('Synthetic #974 reading exhausted');
        return JSON.stringify(next);
      } }), createRenderer: (client, options) => createWeeklyPlanningStableV5DialogueRendererCore(client, options) };
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: savePlan, saveWeeklyActualRecords: saveActuals };
    await act(async () => { renderer = create(createElement(Harness, { ref, input, services })); });
    const app = () => ref.current!;
    const turn = async (text: string) => {
      await act(async () => { await app().submitTurn(text); });
      return app().state.messages.filter(message => message.role === 'assistant').slice(-1)[0]!.content;
    };
    const seed = async () => {
      const reply = await turn('先週は月曜数学60分、火曜英語45分、水曜現代文30分、金曜英語50分、土曜数学120分、日曜化学90分でした。');
      expect(app().pendingActualRecords).toHaveLength(6);
      expect(sumActualRecordMinutes(app().pendingActualRecords!)).toBe(395);
      expect(saveActuals).not.toHaveBeenCalled(); expect(savePlan).not.toHaveBeenCalled();
      return reply;
    };
    return { app, turn, seed, saveActuals, savePlan };
  }

  it('chat save requests retain all six pending records and name the explicit UI action', async () => {
    const h = await scenario([reading(RECORDS), reading()]);
    await h.seed();
    const before = structuredClone(h.app().pendingActualRecords);
    const reply = await h.turn('保存して');
    expect(h.saveActuals).not.toHaveBeenCalled(); expect(h.savePlan).not.toHaveBeenCalled();
    expect(h.app().pendingActualRecords).toEqual(before);
    expect(reply).not.toContain('保存しました');
    expect(reply).toContain(VNEXT_STUDY_RECORD_SAVE_GUIDE);
  });
  it('explains a pending Tuesday correction from 45 to 50 without changing the other five records', async () => {
    const h = await scenario([reading(RECORDS), reading([record('2026-10-27', '英語', 50)])]);
    await h.seed();
    const before = structuredClone(h.app().pendingActualRecords!);
    const reply = await h.turn('火曜の英語は45分ではなく50分でした');
    expect(h.app().pendingActualRecords).toEqual(before.map(row => row.occurrenceDate === '2026-10-27' ? { ...row, minutes: 50 } : row));
    expect(sumActualRecordMinutes(h.app().pendingActualRecords!)).toBe(400);
    expect(h.saveActuals).not.toHaveBeenCalled();
    expect.soft(reply).toContain(formatActualRecordMinutes(45));
    expect.soft(reply).toContain(formatActualRecordMinutes(50));
  });
  it('shows provisional actuals and the reflection question in chat/UI; only the button saves', async () => {
    const h = await scenario([reading(RECORDS), reading()]);
    const reply = await h.seed();
    const confirmation = visibleText(renderer!.toJSON());
    expect.soft(reply, 'conversation').toContain('仮実績');
    expect.soft(reply, 'conversation').toContain(CONFIRM);
    expect.soft(confirmation, 'confirmation UI').toContain('仮実績');
    expect.soft(confirmation, 'confirmation UI').toContain(CONFIRM);
    await h.turn('はい');
    expect(h.saveActuals).not.toHaveBeenCalled(); expect(h.app().pendingActualRecords).toHaveLength(6);
    await act(async () => { renderer!.root.findByType('button').props.onClick(); });
    expect(h.saveActuals).toHaveBeenCalledOnce();
    expect(h.saveActuals.mock.calls[0][0]).toBe(OWNER); expect(h.saveActuals.mock.calls[0][1]).toHaveLength(6);
  });
});
