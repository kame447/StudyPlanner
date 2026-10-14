import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncementUnread } from './useAnnouncementUnread';
import { getAnnouncementReadState, listAnnouncements } from '../services/announcementService';
import type { Announcement, AnnouncementPage } from '../features/announcements/announcement';
vi.mock('../services/announcementService', () => ({ getAnnouncementReadState: vi.fn(), listAnnouncements: vi.fn() }));
const item: Announcement = { id: 'a', category: 'お知らせ', title: '架空のお知らせ', body: '本文', revision: 1, publishedAt: { seconds: 10, nanoseconds: 1 } };
const older = { ...item, id: 'b', publishedAt: { seconds: 9, nanoseconds: 0 } };
const emptyRead = { through: null, items: {} };
let model: ReturnType<typeof useAnnouncementUnread>;
let renderer: ReactTestRenderer;
let foreground: EventTarget;
let visibility: EventTarget & { visibilityState: string };
function Probe({ owner = 'owner', open = false }: { owner?: string; open?: boolean }) { model = useAnnouncementUnread(owner, open); return null; }
async function mount() { await act(async () => { renderer = create(<Probe />); }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  foreground = new EventTarget(); visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', foreground); vi.stubGlobal('document', visibility);
  vi.mocked(listAnnouncements).mockResolvedValue({ items: [item, older], nextCursor: null });
  vi.mocked(getAnnouncementReadState).mockResolvedValue(emptyRead);
});
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('bounded announcement bell evidence', () => {
  it('does not start a read after its owner exits during service loading', async () => {
    act(() => { renderer = create(<Probe />); });
    act(() => renderer.unmount());
    await act(async () => {});
    expect(listAnnouncements).not.toHaveBeenCalled();
    expect(getAnnouncementReadState).not.toHaveBeenCalled();
  });
  it('detects an older unread notice even when the latest has an individual receipt, without loading another page', async () => {
    vi.mocked(getAnnouncementReadState).mockResolvedValue({ through: null, items: { a: item.publishedAt } });
    await mount(); expect(model.status).toBe('unread'); expect(listAnnouncements).toHaveBeenCalledExactlyOnceWith('owner', null);
  });
  it('keeps a fully read first page with more records unknown; the query limit is not a saved-receipt limit', async () => {
    vi.mocked(listAnnouncements).mockResolvedValue({ items: [item], nextCursor: { ...item.publishedAt, id: 'a' } });
    vi.mocked(getAnnouncementReadState).mockResolvedValue({ through: null, items: { a: item.publishedAt } });
    await mount(); expect(model.status).toBe('unknown'); expect(listAnnouncements).toHaveBeenCalledTimes(1);
    vi.mocked(listAnnouncements).mockResolvedValueOnce({ items: [older], nextCursor: null });
    vi.mocked(getAnnouncementReadState).mockResolvedValueOnce(emptyRead);
    await act(async () => { await model.loadPage({ ...item.publishedAt, id: 'a' }); });
    expect(model.status).toBe('unread');
  });
  it('clears after acknowledged receipts only and retains older unread evidence until it is acknowledged', async () => {
    await mount();
    act(() => model.acknowledge({ through: null, items: { a: item.publishedAt } })); expect(model.status).toBe('unread');
    act(() => model.acknowledge({ through: null, items: { b: older.publishedAt } })); expect(model.status).toBe('read');
  });
  it('clears unknown continuation through a bulk-read watermark without fetching remaining pages', async () => {
    vi.mocked(listAnnouncements).mockResolvedValue({ items: [item], nextCursor: { ...item.publishedAt, id: 'a' } });
    await mount(); act(() => model.acknowledge({ through: item.publishedAt, items: {} }));
    expect(model.status).toBe('read'); expect(listAnnouncements).toHaveBeenCalledTimes(1);
  });
  it('shares the initial in-flight page and same-owner cached page with the opened list', async () => {
    let finish!: (page: AnnouncementPage<Announcement>) => void;
    vi.mocked(listAnnouncements).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await mount(); const pending = model.loadPage(null);
    await act(async () => { finish({ items: [item], nextCursor: null }); await pending; });
    await act(async () => { await model.loadPage(null); });
    expect(listAnnouncements).toHaveBeenCalledTimes(1); expect(getAnnouncementReadState).toHaveBeenCalledTimes(1);
  });
  it('refreshes only on visible foreground after five minutes and makes a republished revision unread', async () => {
    vi.mocked(getAnnouncementReadState).mockResolvedValue({ through: item.publishedAt, items: {} });
    await mount(); expect(model.status).toBe('read');
    await act(async () => { foreground.dispatchEvent(new Event('focus')); visibility.dispatchEvent(new Event('visibilitychange')); });
    expect(listAnnouncements).toHaveBeenCalledTimes(1);
    vi.mocked(listAnnouncements).mockResolvedValue({ items: [{ ...item, revision: 2, publishedAt: { seconds: 10, nanoseconds: 2 } }], nextCursor: null });
    vi.advanceTimersByTime(300000); visibility.visibilityState = 'hidden';
    await act(async () => { foreground.dispatchEvent(new Event('focus')); }); expect(listAnnouncements).toHaveBeenCalledTimes(1);
    visibility.visibilityState = 'visible';
    await act(async () => { visibility.dispatchEvent(new Event('visibilitychange')); });
    expect(listAnnouncements).toHaveBeenCalledTimes(2); expect(model.status).toBe('unread');
  });
  it('does not poll while the page is open and ignores failed refreshes rather than clearing unread', async () => {
    await mount(); await act(async () => renderer.update(<Probe open />)); vi.advanceTimersByTime(300000);
    await act(async () => { foreground.dispatchEvent(new Event('focus')); }); expect(listAnnouncements).toHaveBeenCalledTimes(1);
    await act(async () => renderer.update(<Probe />));
    vi.mocked(listAnnouncements).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { foreground.dispatchEvent(new Event('focus')); }); expect(model.status).toBe('unread');
    await act(async () => { foreground.dispatchEvent(new Event('focus')); }); expect(listAnnouncements).toHaveBeenCalledTimes(2);
  });
  it('never applies a previous owner late page or read acknowledgement to the next owner', async () => {
    let finish!: (page: AnnouncementPage<Announcement>) => void;
    vi.mocked(listAnnouncements).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await mount(); const old = model;
    vi.mocked(listAnnouncements).mockResolvedValueOnce({ items: [], nextCursor: null });
    await act(async () => renderer.update(<Probe owner="other" />)); expect(model.status).toBe('read');
    await act(async () => finish({ items: [item], nextCursor: null }));
    act(() => old.acknowledge({ through: item.publishedAt, items: {} })); expect(model.status).toBe('read');
    expect(getAnnouncementReadState).toHaveBeenCalledExactlyOnceWith('other', []);
  });
  it('does not let a delayed first-page read roll back a successful bulk acknowledgement', async () => {
    let finish!: (value: typeof emptyRead) => void;
    vi.mocked(getAnnouncementReadState).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await mount(); act(() => model.acknowledge({ through: item.publishedAt, items: {} }));
    await act(async () => finish(emptyRead)); expect(model.status).toBe('read');
  });
  it('allows the explicit list retry immediately after a failed background check without waiting for its cooldown', async () => {
    vi.mocked(listAnnouncements).mockRejectedValueOnce(new Error('offline'));
    await mount(); expect(model.status).toBe('unknown');
    await act(async () => { await model.loadPage(null); });
    expect(listAnnouncements).toHaveBeenCalledTimes(2); expect(model.status).toBe('unread');
  });
});
