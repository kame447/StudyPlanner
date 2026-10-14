import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsPage } from './AnnouncementsPage';
import { getAnnouncementReadState, listAnnouncements, markAllAnnouncementsRead, markAnnouncementRead } from '../services/announcementService';
vi.mock('../services/announcementService', () => ({ getAnnouncementReadState: vi.fn(), listAnnouncements: vi.fn(), markAllAnnouncementsRead: vi.fn(), markAnnouncementRead: vi.fn() }));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let renderer: ReactTestRenderer;
const item = { id: 'a', title: '公開済み', body: '<script>本文</script>\n2行目', category: 'その他' as const, revision: 1, publishedAt: { seconds: 10, nanoseconds: 9 } };
const items = [item, { ...item, id: 'b', title: '二件目', publishedAt: { seconds: 9, nanoseconds: 0 } }];
const back = vi.fn(); const open = vi.fn();
const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!;
const unread = () => renderer.root.findAllByProps({ 'aria-label': '未読' }).length;
const text = () => JSON.stringify(renderer.toJSON());
const render = (detailId: string | null = null) => <AnnouncementsPage userId="owner" detailId={detailId} onOpenDetail={open} onBack={back} />;
async function mount(detailId: string | null = null) { await act(async () => { renderer = create(render(detailId), { createNodeMock: () => ({ showModal() {}, close() {}, querySelector: () => ({ focus() {} }) }) }); }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('document', { body: {} }); vi.mocked(listAnnouncements).mockResolvedValue({ items, nextCursor: null }); vi.mocked(getAnnouncementReadState).mockResolvedValue({ through: null, items: {} }); vi.mocked(markAllAnnouncementsRead).mockResolvedValue(); vi.mocked(markAnnouncementRead).mockResolvedValue(); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
describe('announcement page', () => {
  it('loads a bounded page only when mounted and marks all through the newest observed publication', async () => {
    await mount(); expect(listAnnouncements).toHaveBeenCalledExactlyOnceWith('owner', null); expect(unread()).toBe(2);
    await act(async () => button('すべて既読').props.onClick()); expect(markAllAnnouncementsRead).toHaveBeenCalledExactlyOnceWith('owner', item.publishedAt); expect(unread()).toBe(0);
  });
  it('opens detail, displays plain text, and records read only after acknowledgement', async () => {
    let finish!: () => void; vi.mocked(markAnnouncementRead).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await mount(); act(() => renderer.root.findAllByProps({ className: 'announcement-row' })[0].props.onClick()); expect(open).toHaveBeenCalledWith('a');
    await act(async () => renderer.update(render('a'))); expect(renderer.root.findByProps({ className: 'announcement-body' }).children).toEqual([item.body]);
    await act(async () => renderer.update(render(null))); expect(unread()).toBe(2); await act(async () => finish()); expect(unread()).toBe(1);
  });
  it('shows read failures without retry loops and supports explicit retry', async () => {
    vi.mocked(markAnnouncementRead).mockRejectedValueOnce(new Error('offline'));
    await mount('a'); expect(text()).toContain('既読を保存できません'); expect(markAnnouncementRead).toHaveBeenCalledTimes(1);
    await act(async () => button('既読を再試行').props.onClick()); expect(markAnnouncementRead).toHaveBeenCalledTimes(2);
    await act(async () => renderer.update(render(null))); expect(unread()).toBe(1);
  });
  it('does not lose a second detail read while the previous one is in flight', async () => {
    let finish!: () => void; vi.mocked(markAnnouncementRead).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await mount('a'); await act(async () => renderer.update(render('b'))); expect(markAnnouncementRead).toHaveBeenCalledTimes(1);
    await act(async () => finish()); expect(markAnnouncementRead).toHaveBeenLastCalledWith('owner', items[1]);
  });
  it('never lets a delayed next-page snapshot undo an acknowledged bulk-read watermark', async () => {
    let finishMark!: () => void;
    let finishPage!: (state: { through: null; items: {} }) => void;
    const cursor = { id: 'b', seconds: 9, nanoseconds: 0 };
    vi.mocked(listAnnouncements).mockResolvedValueOnce({ items, nextCursor: cursor }).mockResolvedValueOnce({ items: [{ ...item, id: 'c', publishedAt: { seconds: 8, nanoseconds: 0 } }], nextCursor: null });
    vi.mocked(getAnnouncementReadState).mockResolvedValueOnce({ through: null, items: {} }).mockReturnValueOnce(new Promise((resolve) => { finishPage = resolve; }));
    vi.mocked(markAllAnnouncementsRead).mockReturnValueOnce(new Promise((resolve) => { finishMark = resolve; }));
    await mount();
    act(() => button('すべて既読').props.onClick());
    await act(async () => button('もっと見る').props.onClick());
    await act(async () => finishMark()); expect(unread()).toBe(0);
    await act(async () => finishPage({ through: null, items: {} }));
    expect(unread()).toBe(0); expect(renderer.root.findAllByProps({ className: 'announcement-row' })).toHaveLength(3);
  });
  it('preserves the failed page cursor and does not label failure as an empty inbox', async () => {
    const cursor = { id: 'b', seconds: 9, nanoseconds: 0 };
    vi.mocked(listAnnouncements).mockResolvedValueOnce({ items, nextCursor: cursor }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [{ ...item, id: 'c' }], nextCursor: null });
    await mount(); await act(async () => button('もっと見る').props.onClick()); expect(text()).toContain('取得できません'); expect(text()).not.toContain('まだありません');
    await act(async () => button('再試行').props.onClick()); expect(listAnnouncements).toHaveBeenLastCalledWith('owner', cursor); expect(renderer.root.findAllByProps({ className: 'announcement-row' })).toHaveLength(3);
  });
});
