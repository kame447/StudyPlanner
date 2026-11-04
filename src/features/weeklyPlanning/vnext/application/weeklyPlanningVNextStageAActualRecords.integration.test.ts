import { expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const ownerId = 'stage-a-actual-owner';
const weekStartDate = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId, weekStartDate, conversationId: 'stage-a-actual-chat',
  notBeforeTime: '09:00', clock: { currentDate: '2026-11-03', planningStartDate: weekStartDate,
    planningEndDate: '2026-11-08', weekStartsOn: 'monday', timeZone: 'Asia/Tokyo' } };
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const recordQuestion = { reason: 'missing_minutes', label: '英語' };
const record = (minutes: number) => ({ dateExpression: weekStartDate, subject: '数学', minutes });
const reading = (add: unknown[] = [], studyRecords: unknown[] = [], studyRecordQuestion: unknown = null) => ({
  planningIntent: 'discuss', conversationActs: [], delta: { ...empty, add }, answer: null,
  studyRecords, studyRecordQuestion, studyRestDays: [],
});

it('retains pending actuals and their question with the Stage A streak on failure, then clears failure history after a record-only correction', async () => {
  const script: Array<unknown | Error> = [reading([
    { kind: 'task', localId: 'math', category: 'study', title: '数学' },
    { kind: 'workload', localId: 'pages', taskRef: { localId: 'math' }, componentRef: null,
      quantityRole: 'remaining', amount: 7, unitCode: 'page', unitLabel: 'ページ', rangeStart: null,
      rangeEnd: null, perOccurrence: false, periodExpression: null },
  ]), reading(), reading(), reading([], [record(60)], recordQuestion),
  new Error('synthetic provider unavailable'), reading([], [record(75)], recordQuestion)];
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate, storage: memory.storage });
  const save = vi.fn(async () => { throw new Error('Unexpected plan save'); });
  const approval = vi.fn(() => { throw new Error('Unexpected approval write'); });
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint,
    legacyV5Checkpoint: { read: () => null }, interpret: createWeeklyPlanningVNextProviderInterpreter(),
    client: { async createChatCompletion() {
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('Script exhausted');
      return JSON.stringify(next);
    } }, approvalLedger: { read: () => null, write: approval },
    plans: { findExistingPlanId: async () => undefined, saveBlock: save },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => '2026-11-03T00:00:00.000Z',
    createRenderer: () => ({ async render() { return { status: 'rendered', text: '数学の見積もりを教えてください。', rawResponse: '' }; } }),
  };
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
    turnId: `turn-${++sequence}`, shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  await turn('数学を7ページ');
  await turn('全部');
  await turn('ない');
  await turn('昨日は数学60分やりました。英語の時間はまだです。');
  const before = local.readCheckpoint()!.vnext;
  expect(before.unansweredQuestionStreak).toMatchObject({ count: 2 });
  expect(before.actualRecords).toHaveLength(1);
  expect(before.actualRecords![0]).toMatchObject({ subject: '数学', minutes: 60, status: 'pending' });
  expect(before.pendingStudyRecordQuestion).toEqual(recordQuestion);
  const failed = await turn('数学の実績は75分に直して');
  expect(failed.outcome).toBe('interpretation_failed');
  const retained = local.readCheckpoint()!.vnext;
  expect(retained.actualRecords).toEqual(before.actualRecords);
  expect(retained.pendingStudyRecordQuestion).toEqual(before.pendingStudyRecordQuestion);
  expect(retained.unansweredQuestionStreak).toEqual(before.unansweredQuestionStreak);
  expect(retained.failureRecovery).toEqual({ reason: 'provider_error', consecutiveCount: 1 });
  expect(retained.state).toEqual(before.state);
  expect(retained.preview).toEqual(before.preview);
  expect(retained.presentedQuestion).toEqual(before.presentedQuestion);
  const corrected = await turn('実績は75分でした');
  expect(corrected.outcome).toBe('applied');
  const after = local.readCheckpoint()!.vnext;
  expect(after.actualRecords![0]).toMatchObject({ subject: '数学', minutes: 75, status: 'pending' });
  expect(after.pendingStudyRecordQuestion).toEqual(recordQuestion);
  expect(after.failureRecovery).toBeUndefined();
  expect(after.unansweredQuestionStreak).toEqual(before.unansweredQuestionStreak);
  expect(after.state).toEqual(before.state);
  expect(after.presentedQuestion).toEqual(before.presentedQuestion);
  expect(save).not.toHaveBeenCalled();
  expect(approval).not.toHaveBeenCalled();

  const envelope = JSON.parse(local.checkpoint.read()!);
  const parse = (fields: Record<string, unknown>) => parseWeeklyPlanningVNextSessionCheckpoint({ ownerId, weekStartDate,
    raw: JSON.stringify({ ...envelope, vnext: { ...envelope.vnext, ...fields } }) });
  expect(parse({ actualRecords: [{ ...after.actualRecords![0], minutes: 0 }] })).toBeNull();
  expect(parse({ actualRecords: [after.actualRecords![0], after.actualRecords![0]] })).toBeNull();
  expect(parse({ pendingStudyRecordQuestion: { ...recordQuestion, label: 42 } })).toBeNull();
  expect(parse({ failureRecovery: { reason: 'provider_error', consecutiveCount: 0 } })).toBeNull();
  expect(parse({ unansweredQuestionStreak: { ...after.unansweredQuestionStreak, count: 0 } })).toBeNull();
  expect(parse({ unknownExtension: true })).toBeNull();
});
