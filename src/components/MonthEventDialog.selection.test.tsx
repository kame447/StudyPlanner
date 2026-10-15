import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { MonthEventDialog } from './MonthEventDialog';
import { createEmptyMonthEventDraft, createMonthEventFromDraft } from '../domain/planner';

const date = '2026-10-14';
const first = createMonthEventFromDraft({ ...createEmptyMonthEventDraft('owner', date), title: '病院' });
const second = createMonthEventFromDraft({ ...createEmptyMonthEventDraft('owner', date), title: '塾' });
function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(node => node.children.includes(label)
    || node.findAllByType('span').some(span => span.children.includes(label)))!;
}
function mount() {
  const save = vi.fn().mockResolvedValue(undefined);
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MonthEventDialog openDate={date} userId="owner" monthEvents={[first, second]}
    onSave={save} onDelete={vi.fn()} onClose={vi.fn()} />); });
  return { renderer, save };
}

it('emphasizes the selected title once per event switch, preserves typing, and returns to add mode', () => {
  const { renderer } = mount();
  try {
    const title = () => renderer.root.findByProps({ 'aria-label': 'タイトル' });
    const rows = () => renderer.root.findAllByType('button').filter(node => node.props.className?.includes('month-event-timeline-item'));
    act(() => rows()[0].props.onClick());
    const firstInput = title();
    expect(firstInput.props.value).toBe('病院');
    expect(rows().map(row => row.props['aria-pressed'])).toEqual([true, false]);
    expect(firstInput.parent!.parent!.props.className).toContain('month-event-title-selected');
    act(() => firstInput.props.onChange({ target: { value: '病院の予約' } }));
    expect(title()).toBe(firstInput);
    expect(title().props.value).toBe('病院の予約');
    act(() => rows()[1].props.onClick());
    expect(title()).not.toBe(firstInput);
    expect(title().props.value).toBe('塾');
    expect(rows().map(row => row.props['aria-pressed'])).toEqual([false, true]);
    act(() => button(renderer, '追加').props.onClick());
    expect(title().props.value).toBe('');
    expect(title().parent!.parent!.props.className).not.toContain('month-event-title-selected');
    expect(rows().every(row => !row.props['aria-pressed'])).toBe(true);
  } finally { act(() => renderer.unmount()); }
});

it.each(['繰り返し', 'URL', '場所', 'メモ', 'チェックリスト'])('toggles %s between plus and minus without leaving the editor', label => {
  const { renderer } = mount();
  try {
    const chip = () => button(renderer, label);
    expect(chip().props['aria-expanded']).toBe(false);
    expect(chip().findAllByType('span')[0].children).toEqual(['＋']);
    act(() => chip().props.onClick());
    expect(chip().props['aria-expanded']).toBe(true);
    expect(chip().findAllByType('span')[0].children).toEqual(['−']);
    const id = chip().props['aria-controls'];
    expect(renderer.root.findAllByProps({ id })).toHaveLength(1);
    act(() => chip().props.onClick());
    expect(chip().props['aria-expanded']).toBe(false);
    expect(renderer.root.findAllByProps({ id })).toHaveLength(0);
    act(() => chip().props.onClick());
    expect(renderer.root.findAllByProps({ id })).toHaveLength(1);
  } finally { act(() => renderer.unmount()); }
});

it('retains a collapsed field through reopening and saves its value while collapsed', async () => {
  const { renderer, save } = mount();
  try {
    act(() => button(renderer, 'メモ').props.onClick());
    act(() => renderer.root.findByProps({ 'aria-label': 'メモ' }).props.onChange({ target: { value: '持ち物' } }));
    act(() => button(renderer, 'メモ').props.onClick());
    act(() => button(renderer, 'メモ').props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': 'メモ' }).props.value).toBe('持ち物');
    act(() => button(renderer, 'メモ').props.onClick());
    act(() => renderer.root.findByProps({ 'aria-label': 'タイトル' }).props.onChange({ target: { value: '予定' } }));
    await act(async () => { button(renderer, '保存').props.onClick(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '予定', memo: '持ち物' }), undefined);
  } finally { act(() => renderer.unmount()); }
});

it('limits the short selection cue to users who allow motion', () => {
  const css = readFileSync(new URL('../styles/modals.css', import.meta.url), 'utf8');
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.month-event-title-selected \.month-event-title-field input\s*\{\s*animation: month-event-title-selection 300ms ease-out;/);
});

it('discloses named radio choices below the times, saves the choice, and can return to automatic color', async () => {
  const { renderer, save } = mount();
  try {
    const body = renderer.root.findByType('fieldset');
    const times = renderer.root.findByProps({ className: 'month-event-datetime-rows' }).parent!;
    const colorSection = renderer.root.findByProps({ 'aria-label': '予定の色' });
    expect(body.children.indexOf(colorSection.parent!)).toBe(body.children.indexOf(times) + 1);
    expect(button(renderer, 'ラベル').props['aria-expanded']).toBe(false);
    expect(renderer.root.findAllByProps({ type: 'radio' })).toHaveLength(0);
    act(() => button(renderer, 'ラベル').props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': '自動' }).props.checked).toBe(true);
    expect(renderer.root.findAllByProps({ type: 'radio' }).map(node => node.props['aria-label'])).toEqual(['自動', '緑', 'オレンジ', '紫', '青', 'ピンク']);
    act(() => renderer.root.findByProps({ 'aria-label': '青' }).props.onChange());
    expect(renderer.root.findByProps({ 'aria-label': '青' }).props.checked).toBe(true);
    expect(renderer.root.findByProps({ 'aria-label': '自動' }).props.checked).toBe(false);
    act(() => button(renderer, '完了').props.onClick());
    expect(button(renderer, 'ラベル').findAllByType('span').some(span => span.children.includes('青'))).toBe(true);
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    act(() => renderer.root.findByProps({ 'aria-label': 'タイトル' }).props.onChange({ target: { value: '青の予定' } }));
    await act(async () => { button(renderer, '保存').props.onClick(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '青の予定', color: 'blue' }), undefined);
  } finally { act(() => renderer.unmount()); }

  let edited!: ReactTestRenderer;
  const event = { ...first, color: 'pink' as const };
  const editSave = vi.fn().mockResolvedValue(undefined);
  act(() => { edited = create(<MonthEventDialog openDate={date} userId="owner" initialEventId={event.id} monthEvents={[event]}
    onSave={editSave} onDelete={vi.fn()} onClose={vi.fn()} />); });
  try {
    act(() => button(edited, 'ラベル').props.onClick());
    expect(edited.root.findByProps({ 'aria-label': 'ピンク' }).props.checked).toBe(true);
    expect(edited.root.findByProps({ className: 'month-event-timeline-item active' }).props.style['--schedule-event-color']).toBe('#ef7b9f');
    act(() => edited.root.findByProps({ 'aria-label': '自動' }).props.onChange());
    expect(edited.root.findByProps({ 'aria-label': 'ピンク' }).props.checked).toBe(false);
    act(() => button(edited, '完了').props.onClick());
    await act(async () => { button(edited, '保存').props.onClick(); });
    expect(editSave.mock.calls[0][0]).toHaveProperty('color', undefined);
    expect(editSave.mock.calls[0][1]).toBe(event.id);
  } finally { act(() => edited.unmount()); }
});


it.each(['single', 'future'] as const)('keeps the selected label in the recurring %s edit request', async scope => {
  const event = { ...first, color: 'pink' as const, repeat: 'weekly' as const };
  const save = vi.fn().mockResolvedValue(undefined);
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MonthEventDialog openDate={date} userId="owner" initialEventId={event.id}
    monthEvents={[event]} onSave={save} onDelete={vi.fn()} onClose={vi.fn()} />); });
  try {
    act(() => button(renderer, 'ラベル').props.onClick());
    act(() => renderer.root.findByProps({ 'aria-label': '青' }).props.onChange());
    act(() => button(renderer, '完了').props.onClick());
    await act(async () => { button(renderer, '保存').props.onClick(); });
    expect(save).not.toHaveBeenCalled();
    expect(button(renderer, 'ラベル').props.disabled).toBe(true);
    act(() => button(renderer, 'ラベル').props.onClick());
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await act(async () => { button(renderer, scope === 'single' ? 'この予定だけ変更' : 'これ以降も全部変更').props.onClick(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ color: 'blue' }), event.id,
      expect.objectContaining({ source: event, occurrenceDate: date, scope }));
  } finally { act(() => renderer.unmount()); }
});

it('shows the newly selected event color instead of the previous draft choice', () => {
  const { renderer } = mount();
  try {
    act(() => button(renderer, 'ラベル').props.onClick());
    act(() => renderer.root.findByProps({ 'aria-label': '青' }).props.onChange());
    act(() => button(renderer, '完了').props.onClick());
    const rows = renderer.root.findAllByType('button').filter(node => node.props.className?.includes('month-event-timeline-item'));
    act(() => rows[0].props.onClick());
    expect(button(renderer, 'ラベル').props['aria-expanded']).toBe(false);
    act(() => button(renderer, 'ラベル').props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': '自動' }).props.checked).toBe(true);
  } finally { act(() => renderer.unmount()); }
});
