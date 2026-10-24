import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAnnouncementsPage } from './AdminAnnouncementsPage';
import { listAnnouncementDrafts, newAnnouncementId, publishAnnouncement, saveAnnouncementDraft } from '../services/announcementService';
vi.mock('../services/announcementService', () => ({ listAnnouncementDrafts: vi.fn(), newAnnouncementId: vi.fn(), publishAnnouncement: vi.fn(), saveAnnouncementDraft: vi.fn() }));
let renderer: ReactTestRenderer;
const draft = { id: 'a', title: 'タイトル', body: '本文', category: 'その他' as const, revision: 1, publishedRevision: 0, updatedAt: { seconds: 1, nanoseconds: 2 } };
const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!;
const text = () => JSON.stringify(renderer.toJSON());
async function mount() { await act(async () => { renderer = create(<AdminAnnouncementsPage userId="admin" />); }); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listAnnouncementDrafts).mockResolvedValue({ items: [draft], nextCursor: null }); vi.mocked(newAnnouncementId).mockReturnValue('new'); vi.mocked(saveAnnouncementDraft).mockResolvedValue(); vi.mocked(publishAnnouncement).mockResolvedValue(); });
afterEach(() => act(() => renderer?.unmount()));
describe('admin announcements', () => {
  it('opens a draft for review without publishing and publishes directly from the editor', async () => {
    await mount(); act(() => button('編集').props.onClick()); expect(text()).toContain('お知らせを編集');
    expect(publishAnnouncement).not.toHaveBeenCalled();
    act(() => button('キャンセル').props.onClick()); expect(publishAnnouncement).not.toHaveBeenCalled();
    act(() => button('編集').props.onClick()); await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    expect(saveAnnouncementDraft).not.toHaveBeenCalled();
    expect(publishAnnouncement).toHaveBeenCalledExactlyOnceWith('admin', 'a', 1); expect(text()).toContain('公開しました');
  });
  it('saves drafts without publication and keeps the same ID for a failed retry', async () => {
    await mount(); act(() => button('新しいお知らせ').props.onClick());
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '新規' } }));
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '本文' } }));
    vi.mocked(saveAnnouncementDraft).mockRejectedValueOnce(new Error('offline'));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })); expect(text()).toContain('offline'); expect(publishAnnouncement).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(vi.mocked(saveAnnouncementDraft).mock.calls[0]).toEqual(vi.mocked(saveAnnouncementDraft).mock.calls[1]); expect(newAnnouncementId).toHaveBeenCalledTimes(1);
  });
  it('creates and publishes with one explicit action, retaining the saved revision after a publication failure', async () => {
    await mount(); act(() => button('新しいお知らせ').props.onClick());
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '新規' } }));
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '本文' } }));
    vi.mocked(publishAnnouncement).mockRejectedValueOnce(new Error('公開offline'));
    await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    expect(saveAnnouncementDraft).toHaveBeenCalledExactlyOnceWith('admin', 'new', 0, { category: 'お知らせ', title: '新規', body: '本文' });
    expect(publishAnnouncement).toHaveBeenCalledExactlyOnceWith('admin', 'new', 1); expect(text()).toContain('公開offline');
    await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    expect(saveAnnouncementDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishAnnouncement).mock.calls).toEqual([['admin', 'new', 1], ['admin', 'new', 1]]);
  });
  it('keeps content editable and saves the next revision if changed after publication failure', async () => {
    await mount(); act(() => button('編集').props.onClick());
    vi.mocked(publishAnnouncement).mockRejectedValueOnce(new Error('offline'));
    await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '修正' } }));
    await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    expect(saveAnnouncementDraft).toHaveBeenCalledExactlyOnceWith('admin', 'a', 1, { category: 'その他', title: '修正', body: '本文' });
    expect(publishAnnouncement).toHaveBeenLastCalledWith('admin', 'a', 2);
  });
  it('does not publish invalid input or a failed save', async () => {
    await mount(); act(() => button('新しいお知らせ').props.onClick());
    await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    expect(saveAnnouncementDraft).not.toHaveBeenCalled(); expect(publishAnnouncement).not.toHaveBeenCalled();
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '新規' } }));
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '本文' } }));
    vi.mocked(saveAnnouncementDraft).mockRejectedValueOnce(new Error('conflict'));
    await act(async () => button('公開').props.onClick({ preventDefault() {} }));
    expect(publishAnnouncement).not.toHaveBeenCalled(); expect(text()).toContain('conflict');
  });
  it('locks duplicate submissions and never begins publication after owner page exit', async () => {
    let finish!: () => void; vi.mocked(saveAnnouncementDraft).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount(); act(() => button('編集').props.onClick());
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '更新' } }));
    const submit = button('公開').props.onClick;
    act(() => { submit({ preventDefault() {} }); submit({ preventDefault() {} }); });
    expect(saveAnnouncementDraft).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount()); await act(async () => finish());
    expect(publishAnnouncement).not.toHaveBeenCalled(); expect(listAnnouncementDrafts).toHaveBeenCalledTimes(1);
  });
  it('rejects a retained publish callback after exit even when no draft save is needed', async () => {
    await mount(); act(() => button('編集').props.onClick()); const submit = button('公開').props.onClick;
    act(() => renderer.unmount());
    await act(async () => submit({ preventDefault() {} }));
    expect(saveAnnouncementDraft).not.toHaveBeenCalled(); expect(publishAnnouncement).not.toHaveBeenCalled();
  });
  it('retains a failed cursor and distinguishes empty from unavailable', async () => {
    const cursor = { id: 'a', seconds: 1, nanoseconds: 2 };
    vi.mocked(listAnnouncementDrafts).mockResolvedValueOnce({ items: [draft], nextCursor: cursor }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
    await mount(); await act(async () => button('次の25件').props.onClick()); expect(text()).toContain('取得できません'); expect(text()).not.toContain('まだありません');
    await act(async () => button('再試行').props.onClick()); expect(listAnnouncementDrafts).toHaveBeenLastCalledWith('admin', cursor);
  });
});
