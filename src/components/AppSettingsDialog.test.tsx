import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsDialog } from './AppSettingsDialog';
import type { UserPlanningContextRecordV1 } from '../features/userPlanningContext/userPlanningContextTypes';

const state = vi.hoisted(() => ({
  memory: { records: [] as UserPlanningContextRecordV1[], shared: true, syncing: false, error: null,
    saveNaturalLanguage: vi.fn(async () => undefined), removeRecord: vi.fn(async () => undefined) },
  weekStartsOn: 'monday', setWeekStartsOn: vi.fn(async () => true), resetProfile: vi.fn(async () => true),
}));
vi.mock('../features/userPlanningContext/UserPlanningContextContext', () => ({ useOptionalUserPlanningContextV1: () => state.memory }));
vi.mock('../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext', () => ({ useWeeklyPlanningPersonalization: () => state }));
let renderer: ReactTestRenderer;
const props = { open: true, themeMode: 'light' as const, themePalette: 'forest' as const,
  onChangeTheme: vi.fn(), onChangeThemePalette: vi.fn(), onClose: vi.fn(), onChangeMonthTimetable: vi.fn() };
const focus = vi.fn();
function mount() { act(() => { renderer = create(<AppSettingsDialog {...props} />, { createNodeMock: () => ({ focus, scrollTop: 0 }) }); }); }
const button = (text: string) => renderer.root.findAllByType('button').find(node => node.children.includes(text))!;
function selectTab(id: string) { act(() => renderer.root.findByProps({ id: `app-settings-tab-${id}` }).props.onClick()); }
beforeEach(() => { vi.clearAllMocks(); state.memory.records = []; state.memory.syncing = false; state.memory.saveNaturalLanguage.mockResolvedValue(undefined); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

describe('standalone readable settings', () => {
  it('exposes a named page, focusable heading, grouped settings and a Back action without a modal', () => {
    mount();
    expect(renderer.root.findByType('main').props['aria-labelledby']).toBe('app-settings-title');
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(renderer.root.findByType('h1').props.tabIndex).toBe(-1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(renderer.root.findAllByType('h2').map(node => node.children.join(''))).toEqual(['表示とデザイン', 'カレンダーと学習', 'AIについて']);
    const back = renderer.root.findByProps({ className: 'settings-back-button' });
    act(() => back.props.onClick()); expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('今後の設定項目');
  });

  it('supports arrow/Home/End tabs with one tab stop and connected panels', () => {
    mount();
    const key = (id: string, value: string) => {
      const preventDefault = vi.fn();
      act(() => renderer.root.findByProps({ id: `app-settings-tab-${id}` }).props.onKeyDown({ key: value, preventDefault }));
      expect(preventDefault).toHaveBeenCalledTimes(1);
    };
    key('settings', 'ArrowRight');
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['aria-labelledby']).toBe('app-settings-tab-memory');
    expect(renderer.root.findAllByProps({ role: 'tab' }).filter(tab => tab.props.tabIndex === 0)).toHaveLength(1);
    key('memory', 'End');
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['aria-labelledby']).toBe('app-settings-tab-support');
    expect(renderer.root.findAllByType('a').map(link => link.props.href)).toEqual(['/contact', '/terms', '/privacy']);
    key('support', 'Home'); key('settings', 'ArrowLeft');
    expect(renderer.root.findByProps({ id: 'app-settings-tab-support' }).props['aria-selected']).toBe(true);
  });

  it('retains theme/palette, timetable, week and confirmed reset actions', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) }); mount();
    act(() => button('ダーク').props.onClick()); expect(props.onChangeTheme).toHaveBeenCalledWith('dark');
    const palette = renderer.root.findByProps({ 'aria-controls': 'settings-palette-options' });
    act(() => palette.props.onClick()); expect(palette.props['aria-expanded']).toBe(true);
    const options = renderer.root.findAllByProps({ className: 'theme-palette-button' });
    act(() => options[0].props.onClick()); expect(props.onChangeThemePalette).toHaveBeenCalledWith('ocean');
    act(() => button('表示しない').props.onClick()); expect(props.onChangeMonthTimetable).toHaveBeenCalledWith(false);
    act(() => button('日曜日').props.onClick()); expect(state.setWeekStartsOn).toHaveBeenCalledWith('sunday');
    const reset = renderer.root.findByProps({ className: 'settings-row settings-row-button settings-reset-row' });
    act(() => reset.props.onClick()); expect(state.resetProfile).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true); act(() => reset.props.onClick());
    expect(state.resetProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps natural-language memory editing, failures, cancellation and forget confirmation', async () => {
    const record: UserPlanningContextRecordV1 = { id: 'memory-1', ownerId: 'u', kind: 'concern', label: '数学', value: '苦手',
      dateExpression: null, observedDate: '2026-10-07', resolvedDate: null, sourceText: '数学が苦手です',
      sourceConversationId: 'c', sourceTurnId: 't', recordedAt: '2026-10-07T00:00:00Z', status: 'active', origin: 'user_confirmed' };
    state.memory.records = [record]; vi.stubGlobal('window', { confirm: vi.fn(() => false) }); mount(); selectTab('memory');
    act(() => renderer.root.findByProps({ 'aria-label': 'この内容を編集' }).props.onClick());
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '英単語を15分ずつ勉強したい' } }));
    state.memory.saveNaturalLanguage.mockRejectedValueOnce(new Error('保存できませんでした。'));
    await act(async () => button('更新').props.onClick());
    expect(state.memory.saveNaturalLanguage).toHaveBeenCalledWith({ existingRecordId: 'memory-1', text: '英単語を15分ずつ勉強したい' });
    expect(renderer.root.findByType('textarea').props.value).toBe('英単語を15分ずつ勉強したい');
    expect(JSON.stringify(renderer.toJSON())).toContain('保存できませんでした。');
    act(() => button('キャンセル').props.onClick()); expect(renderer.root.findAllByType('textarea')).toHaveLength(0);
    const forget = renderer.root.findByProps({ 'aria-label': 'この内容を忘れる' });
    act(() => forget.props.onClick()); expect(state.memory.removeRecord).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => forget.props.onClick()); expect(state.memory.removeRecord).toHaveBeenCalledWith('memory-1');
    act(() => button('追加').props.onClick());
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '短い時間で集中したい' } }));
    await act(async () => button('覚えておく').props.onClick());
    expect(state.memory.saveNaturalLanguage).toHaveBeenLastCalledWith({ existingRecordId: null, text: '短い時間で集中したい' });
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0);
  });

  it('resets transient controls on close/reopen and disables editing while syncing', () => {
    state.memory.syncing = true; mount(); selectTab('memory');
    expect(button('追加').props.disabled).toBe(true);
    act(() => renderer.update(<AppSettingsDialog {...props} open={false} />)); expect(renderer.toJSON()).toBeNull();
    act(() => renderer.update(<AppSettingsDialog {...props} />));
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['aria-labelledby']).toBe('app-settings-tab-settings');
  });
});
