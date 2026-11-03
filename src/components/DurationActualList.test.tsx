import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DurationActual } from '../types/domain';
import { DurationActualDetail, DurationActualList } from './DurationActualList';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';

const actual = (id: string, subject: string, minutes: number, note = ''): DurationActual => ({
  id, userId: 'owner', planId: null, occurrenceDate: '2026-10-26', actualDurationMinutes: minutes, title: subject, subject,
  isAlignedToPlan: false, note, updatedAt: '2026-11-03T00:00:00.000Z',
});
const textOf = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
afterEach(() => { vi.unstubAllGlobals(); });

describe('DurationActualList', () => {
  it('renders nothing without records', () => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<DurationActualList actuals={[]} onSelect={vi.fn()} />); });
    expect(renderer.toJSON()).toBeNull();
  });

  it('lists each record as 時刻なし with its length and the day total, without any clock time', () => {
    const onSelect = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<DurationActualList actuals={[actual('a', '数学', 60), actual('b', '英語', 45)]} onSelect={onSelect} />); });
    const text = textOf(renderer);
    expect(text).toContain('時刻なし');
    expect(text).toContain('60分（1時間）');
    expect(text).toContain('45分');
    expect(text).toContain('105分（1時間45分）');
    expect(text).not.toMatch(/\d{2}:\d{2}/u);
    act(() => { renderer.root.findAllByType('button')[0].props.onClick(); });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
});

describe('a duration actual opened in the existing standalone editor', () => {
  const props = (record: DurationActual, onDeleteActual = vi.fn(async () => undefined), onClose = vi.fn()) => ({
    actual: record, plans: [], actuals: [record], onSaveStandaloneActual: vi.fn(async () => undefined),
    onLinkStandaloneActualToPlan: vi.fn(async () => undefined), onDeleteActual, onClose,
  });

  it('shows the record with its length and offers no time editing, saving or plan linking', () => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<StandaloneActualEditorCard {...props(actual('a', '数学', 120, '過去問'))} />); });
    const text = textOf(renderer);
    expect(text).toContain('120分（2時間）');
    expect(text).toContain('過去問');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAllByType('button').map((button) => JSON.stringify(button.props.children))).toEqual(['"記録を削除"']);
  });

  it('deletes through the existing delete callback and closes, after the confirmation', async () => {
    vi.stubGlobal('window', { confirm: () => true });
    const record = actual('a', '数学', 60);
    const onDeleteActual = vi.fn(async () => undefined);
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<DurationActualDetail actual={record} onDeleteActual={onDeleteActual} onClose={onClose} />); });
    await act(async () => { renderer.root.findByType('button').props.onClick(); });
    expect(onDeleteActual).toHaveBeenCalledWith(record);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not delete when the confirmation is declined, and keeps the dialog open with an error when deleting fails', async () => {
    const record = actual('a', '数学', 60);
    const onDeleteActual = vi.fn(async () => { throw new Error('fail'); });
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<DurationActualDetail actual={record} onDeleteActual={onDeleteActual} onClose={onClose} />); });
    vi.stubGlobal('window', { confirm: () => false });
    await act(async () => { renderer.root.findByType('button').props.onClick(); });
    expect(onDeleteActual).not.toHaveBeenCalled();
    vi.stubGlobal('window', { confirm: () => true });
    await act(async () => { renderer.root.findByType('button').props.onClick(); });
    expect(onDeleteActual).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('削除できませんでした');
  });
});
