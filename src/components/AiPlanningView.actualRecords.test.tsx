import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import type { PendingWeeklyPlanningActualRecord } from '../features/weeklyPlanning/application/weeklyPlanningActualRecords';
import { createInitialPlanningState } from '../features/weeklyPlanning/weeklyPlanningReducer';
import { AiPlanningView } from './AiPlanningView';

vi.mock('./AiPlanningViewLegacy', () => ({ AiPlanningView: () => null }));
vi.mock('./AiPlanningPreviewDialog', () => ({ AiPlanningPreviewDialog: () => null }));

// The independent fixed scenario of ARGON-FIRST.md: 2026-10-26 (Mon) … 11-01 (Sun), 395 minutes in all; Thursday is a rest day.
const week: PendingWeeklyPlanningActualRecord[] = [
  { id: 'r-1026', occurrenceDate: '2026-10-26', subject: '数学', minutes: 60 },
  { id: 'r-1027', occurrenceDate: '2026-10-27', subject: '英語', minutes: 45 },
  { id: 'r-1028', occurrenceDate: '2026-10-28', subject: '現代文', minutes: 30 },
  { id: 'r-1030', occurrenceDate: '2026-10-30', subject: '英語', minutes: 50 },
  { id: 'r-1031', occurrenceDate: '2026-10-31', subject: '数学', minutes: 120 },
  { id: 'r-1101', occurrenceDate: '2026-11-01', subject: '化学', minutes: 90 },
];

class PreviewTrigger { closest() { return this; } }
let renderer: ReactTestRenderer | undefined;
let records: PendingWeeklyPlanningActualRecord[];
let publish: (next: PendingWeeklyPlanningActualRecord[]) => void;
const checkpoint = vi.fn();
let approveActualRecords: ReturnType<typeof vi.fn>;

function Harness() {
  const [visible, setVisible] = useState(records);
  publish = setVisible;
  const application = {
    state: createInitialPlanningState('2026-10-26'), pendingDraftBlocks: [],
    approvalAvailability: { kind: 'eligible' },
    chat: { checkpoint, requiresInitialization: false },
    pendingActualRecords: visible, approveActualRecords,
  } as unknown as WeeklyPlanningApplication;
  return <AiPlanningView application={application} userId="exam-user" selectedDate="2026-10-26" plans={[]} />;
}

function openConfirmation() {
  act(() => {
    renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
      target: new PreviewTrigger(), preventDefault() {}, stopPropagation() {},
    });
  });
}
const dialogs = () => renderer!.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === '実績の確認');
const saveButton = (): ReactTestInstance => renderer!.root.find(node =>
  node.type === 'button' && String(node.props.className ?? '').includes('ai-planning-actual-records-save'));
const text = (node: ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : text(child))).join('');
const buttonLabel = () => text(saveButton());
const rows = () => renderer!.root.findAll(node => node.type === 'li').map(text);
const alerts = () => renderer!.root.findAll(node => node.props.role === 'alert').map(text);

beforeEach(() => {
  vi.stubGlobal('Element', PreviewTrigger);
  checkpoint.mockClear();
  approveActualRecords = vi.fn(() => Promise.resolve());
  records = week;
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it('shows one row per day, no row for the rest day, the code-made total and no clock time, and saves nothing yet', () => {
  expect(week.reduce((sum, record) => sum + record.minutes, 0)).toBe(395);
  openConfirmation();
  expect(dialogs()).toHaveLength(1);
  expect(rows()).toEqual([
    '月 10/26 数学 60分（1時間）',
    '火 10/27 英語 45分',
    '水 10/28 現代文 30分',
    '金 10/30 英語 50分',
    '土 10/31 数学 120分（2時間）',
    '日 11/1 化学 90分（1時間30分）',
  ]);
  expect(text(renderer!.root.findByProps({ 'aria-label': '実績の合計' }))).toBe('合計 6時間35分（395分）');
  expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/\d{1,2}:\d{2}/);
  expect(approveActualRecords).not.toHaveBeenCalled();
});

it('saves exactly once for any number of activations while the first save is running', async () => {
  let finish!: () => void;
  approveActualRecords.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  openConfirmation();
  const { onClick } = saveButton().props;
  await act(async () => { for (let i = 0; i < 5; i += 1) onClick(); });
  expect(approveActualRecords).toHaveBeenCalledOnce();
  expect(dialogs()).toHaveLength(1);
  expect(text(renderer!.root.findByProps({ className: 'ai-planning-actual-records-note' }))).toBe('保存中（まだ確定していません）');
  expect(buttonLabel()).toBe('保存中...');
  expect(saveButton().props.disabled).toBe(true);
  await act(async () => { finish(); });
});

it('keeps every record after a failed save, shows the error and lets the same button retry', async () => {
  approveActualRecords.mockRejectedValueOnce(new Error('学習実績を保存できませんでした。保存はされていません。'));
  openConfirmation();
  await act(async () => { saveButton().props.onClick(); });
  expect(alerts()).toEqual(['学習実績を保存できませんでした。保存はされていません。']);
  expect(rows()).toHaveLength(6);
  expect(buttonLabel()).toBe('実績の保存を再試行');
  await act(async () => { saveButton().props.onClick(); });
  expect(approveActualRecords).toHaveBeenCalledTimes(2);
  expect(alerts()).toEqual([]);
});

it('closes the confirmation once the records are saved and offers nothing again', async () => {
  openConfirmation();
  await act(async () => { saveButton().props.onClick(); });
  await act(async () => { publish([]); });
  expect(dialogs()).toHaveLength(0);
  expect(rows()).toEqual([]);
});
