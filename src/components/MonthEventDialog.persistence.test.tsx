import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { MonthEventDialog } from './MonthEventDialog';
import { TimeWheelPicker } from './TimeRangeFields';
import { createEmptyMonthEventDraft, createMonthEventFromDraft } from '../domain/planner';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import type { MonthEvent } from '../types/domain';

const repository = vi.hoisted(() => ({ upsertMonthEvent: vi.fn(), deleteMonthEvent: vi.fn() }));
vi.mock('../repositories', () => ({ plannerRepository: repository }));
const close = vi.fn(); const notice = vi.fn();
let planner: UsePlannerDataStateResult;
const DATE = '2026-12-15';
function Harness({ openDate = DATE, targetId, owner = 'owner-a' }: { openDate?: string | null; targetId?: string; owner?: string }) {
  planner = usePlannerDataState({ userId: owner, showNotice: notice });
  return <MonthEventDialog openDate={openDate} initialEventId={targetId} userId={owner} monthEvents={planner.monthEvents}
    onSave={planner.saveMonthEvent} onDelete={planner.deleteMonthEvent} onClose={close} />;
}
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(node => node.children.includes(label)
    || node.findAllByType('span').some(span => span.children.includes(label)))!;
}
function title(renderer: ReactTestRenderer) { return renderer.root.findByProps({ 'aria-label': 'タイトル' }); }
async function enter(renderer: ReactTestRenderer, label: string, value: string) {
  await act(async () => { renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }); });
}
function savedEvent(repeat: MonthEvent['repeat'] = 'none') {
  return createMonthEventFromDraft({ ...createEmptyMonthEventDraft('owner-a', DATE), title: '元の予定', memo: '元のメモ', repeat });
}
beforeEach(() => {
  vi.clearAllMocks();
  repository.upsertMonthEvent.mockReset().mockResolvedValue(undefined);
  repository.deleteMonthEvent.mockReset().mockResolvedValue(undefined);
});

it.each(['create', 'edit'] as const)('retains %s input through optimistic updates and failure, then retries once', async mode => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness openDate={null} />); });
  try {
    if (mode === 'edit') await act(async () => {
      await planner.saveMonthEvent({ ...createEmptyMonthEventDraft('owner-a', DATE), title: '元の予定' });
    });
    const original = structuredClone(planner.monthEvents);
    const targetId = original[0]?.id;
    await act(async () => { renderer.update(<Harness targetId={targetId} />); });
    await enter(renderer, 'タイトル', '入力を残す予定');
    await act(async () => { button(renderer, 'メモ').props.onClick(); });
    await enter(renderer, 'メモ', '失敗しても残すメモ');
    await act(async () => { button(renderer, 'チェックリスト').props.onClick(); });
    await act(async () => { button(renderer, '項目を追加').props.onClick(); });
    await act(async () => {
      renderer.root.findByProps({ placeholder: '確認事項' }).props.onChange({ target: { value: '持ち物' } });
    });
    const pending = deferred();
    repository.upsertMonthEvent.mockClear().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
    await act(async () => { button(renderer, '保存').props.onClick(); button(renderer, '保存').props.onClick(); });
    expect(repository.upsertMonthEvent).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(renderer.root.findByType('fieldset').props.disabled).toBe(true);
    expect(title(renderer).props.value).toBe('入力を残す予定');
    await act(async () => {
      button(renderer, '閉じる').props.onClick();
      button(renderer, '新規').props.onClick();
      renderer.root.findByProps({ className: 'overlay modal-overlay month-event-modal-overlay' }).props.onClick();
      renderer.root.findAllByType(TimeWheelPicker)[0].props.onChange('12:00');
      renderer.root.findAllByType('button').find(node => node.props.className?.includes('month-event-timeline-item'))?.props.onClick();
    });
    expect(close).not.toHaveBeenCalled();
    expect(title(renderer).props.value).toBe('入力を残す予定');
    expect(renderer.root.findAllByType(TimeWheelPicker)[0].props.value).not.toBe('12:00');
    await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(() => undefined); });
    expect(planner.monthEvents).toEqual(original);
    expect(title(renderer).props.value).toBe('入力を残す予定');
    expect(renderer.root.findByProps({ 'aria-label': 'メモ' }).props.value).toBe('失敗しても残すメモ');
    expect(renderer.root.findByProps({ placeholder: '確認事項' }).props.value).toBe('持ち物');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度保存');
    expect(button(renderer, '保存').props.disabled).toBe(false);
    await act(async () => { button(renderer, '保存').props.onClick(); });
    expect(repository.upsertMonthEvent).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(planner.monthEvents).toHaveLength(1);
    expect(planner.monthEvents[0]).toMatchObject({ title: '入力を残す予定', memo: '失敗しても残すメモ', checklist: [expect.objectContaining({ text: '持ち物' })] });
    if (targetId) expect(planner.monthEvents[0].id).toBe(targetId);
    // The exit animation may keep the successful editor mounted briefly.
    await act(async () => { button(renderer, '保存').props.onClick(); });
    expect(repository.upsertMonthEvent).toHaveBeenCalledTimes(2);
  } finally { act(() => renderer.unmount()); }
});

it('waits for a missing edit target, initializes once, and resets only for a new editing session', async () => {
  const event = savedEvent();
  const save = vi.fn().mockResolvedValue(undefined);
  const props = { openDate: DATE, userId: 'owner-a', initialEventId: event.id, onSave: save, onDelete: vi.fn(), onClose: close };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<MonthEventDialog {...props} monthEvents={[]} />); });
  try {
    expect(button(renderer, '保存').props.disabled).toBe(true);
    await act(async () => { button(renderer, '保存').props.onClick(); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<MonthEventDialog {...props} monthEvents={[event]} />); });
    expect(title(renderer).props.value).toBe('元の予定');
    await enter(renderer, 'タイトル', '編集中');
    await act(async () => { renderer.update(<MonthEventDialog {...props} monthEvents={[{ ...event, title: '一覧更新' }]} />); });
    expect(title(renderer).props.value).toBe('編集中');
    await act(async () => { renderer.update(<MonthEventDialog {...props} openDate={null} monthEvents={[event]} />); });
    await act(async () => { renderer.update(<MonthEventDialog {...props} monthEvents={[event]} />); });
    expect(title(renderer).props.value).toBe('元の予定');
  } finally { act(() => renderer.unmount()); }
});

it('ignores old save completions after the owner, date, target or mounted session changes', async () => {
  for (const change of ['owner', 'date', 'target', 'unmount'] as const) {
    const event = savedEvent(); const pending = deferred(); const save = vi.fn(() => pending.promise); close.mockClear();
    const props = { openDate: DATE, userId: 'owner-a', monthEvents: [event], onSave: save, onDelete: vi.fn(), onClose: close };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<MonthEventDialog {...props} />); });
    try {
      await enter(renderer, 'タイトル', '古い入力');
      await act(async () => { button(renderer, '保存').props.onClick(); });
      await act(async () => {
        renderer.update(change === 'unmount' ? <></> : <MonthEventDialog {...props}
          userId={change === 'owner' ? 'owner-b' : props.userId}
          openDate={change === 'date' ? '2027-01-15' : DATE}
          initialEventId={change === 'target' ? event.id : undefined} />);
      });
      if (change !== 'unmount') await enter(renderer, 'タイトル', '新しい入力');
      await act(async () => { pending.resolve(); await pending.promise; });
      expect(close).not.toHaveBeenCalled();
      if (change !== 'unmount') expect(title(renderer).props.value).toBe('新しい入力');
    } finally { act(() => renderer.unmount()); }
  }
});

it.each(['none', 'single', 'future'] as const)('keeps failed %s deletion retryable without discarding edited input', async scope => {
  const event = savedEvent(scope === 'none' ? 'none' : 'weekly');
  const pending = deferred(); const remove = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  vi.stubGlobal('window', { confirm: () => true });
  let renderer!: ReactTestRenderer;
  const props = { openDate: DATE, userId: 'owner-a', initialEventId: event.id, monthEvents: [event], onSave: save, onDelete: remove, onClose: close };
  await act(async () => { renderer = create(<MonthEventDialog {...props} />); });
  try {
    await enter(renderer, 'タイトル', '編集中の内容');
    await act(async () => { button(renderer, '削除').props.onClick(); });
    const actionLabel = scope === 'single' ? 'この予定だけ削除' : scope === 'future' ? 'これ以降も全部削除' : '削除';
    if (scope !== 'none') await act(async () => { button(renderer, actionLabel).props.onClick(); });
    expect(remove.mock.calls.length + save.mock.calls.length).toBe(1);
    await act(async () => { renderer.update(<MonthEventDialog {...props} monthEvents={[]} />); });
    expect(close).not.toHaveBeenCalled();
    expect(title(renderer).props.value).toBe('編集中の内容');
    await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(() => undefined); });
    await act(async () => { renderer.update(<MonthEventDialog {...props} />); });
    expect(title(renderer).props.value).toBe('編集中の内容');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('削除できません');
    await act(async () => { button(renderer, actionLabel).props.onClick(); });
    expect(remove.mock.calls.length + save.mock.calls.length).toBe(2);
    expect(close).toHaveBeenCalledTimes(1);
  } finally { act(() => renderer.unmount()); vi.unstubAllGlobals(); }
});
