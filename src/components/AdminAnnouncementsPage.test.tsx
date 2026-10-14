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
  it('previews without publishing; cancel is side-effect free', async () => {
    await mount(); act(() => button('公開内容を確認').props.onClick()); expect(text()).toContain('公開内容の確認'); expect(publishAnnouncement).not.toHaveBeenCalled();
    act(() => button('キャンセル').props.onClick()); expect(publishAnnouncement).not.toHaveBeenCalled();
    act(() => button('公開内容を確認').props.onClick()); await act(async () => button('この内容で公開').props.onClick());
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
  it('locks double publish and discards acknowledgement after exit', async () => {
    let finish!: () => void; vi.mocked(publishAnnouncement).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount(); act(() => button('公開内容を確認').props.onClick());
    act(() => { button('この内容で公開').props.onClick(); button('この内容で公開').props.onClick(); }); expect(publishAnnouncement).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount()); await act(async () => finish()); expect(listAnnouncementDrafts).toHaveBeenCalledTimes(1);
  });
  it('retains a failed cursor and distinguishes empty from unavailable', async () => {
    const cursor = { id: 'a', seconds: 1, nanoseconds: 2 };
    vi.mocked(listAnnouncementDrafts).mockResolvedValueOnce({ items: [draft], nextCursor: cursor }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
    await mount(); await act(async () => button('次の25件').props.onClick()); expect(text()).toContain('取得できません'); expect(text()).not.toContain('まだありません');
    await act(async () => button('再試行').props.onClick()); expect(listAnnouncementDrafts).toHaveBeenLastCalledWith('admin', cursor);
  });
});
