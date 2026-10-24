import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnouncementsButton } from './AnnouncementsButton';
import { getAnnouncementReadState, listAnnouncements } from '../services/announcementService';
vi.mock('../services/announcementService', () => ({ getAnnouncementReadState: vi.fn(), listAnnouncements: vi.fn() }));
vi.mock('../hooks/useAnnouncementsNavigation', () => ({ useAnnouncementsNavigation: () => ({ isOpen: false, detailId: null, open: vi.fn(), back: vi.fn() }) }));
let renderer: ReactTestRenderer;
const item = { id: 'a', title: '架空のお知らせ', body: '本文', category: 'お知らせ' as const, revision: 1, publishedAt: { seconds: 10, nanoseconds: 0 } };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.mocked(listAnnouncements).mockResolvedValue({ items: [item], nextCursor: null });
  vi.mocked(getAnnouncementReadState).mockResolvedValue({ through: null, items: {} });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
it('adds a small accessible unread mark while preserving the bell action name and opener focus', async () => {
  await act(async () => { renderer = create(<AnnouncementsButton userId="owner" />); });
  expect(renderer.root.findAllByProps({ 'aria-label': '未読のお知らせあり' })).toHaveLength(1);
  const bell = renderer.root.findByProps({ 'aria-label': 'お知らせを開く' });
  expect(bell.props['aria-describedby']).toBe('announcement-bell-unread');
  const focus = vi.fn(); act(() => bell.props.onClick({ currentTarget: { focus } }));
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
it('does not label an unconfirmed page or a new account with the previous account unread mark', async () => {
  await act(async () => { renderer = create(<AnnouncementsButton userId="owner" />); });
  vi.mocked(listAnnouncements).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => renderer.update(<AnnouncementsButton userId="other" />));
  expect(renderer.root.findAllByProps({ 'aria-label': '未読のお知らせあり' })).toHaveLength(0);
  expect(renderer.root.findByProps({ 'aria-label': 'お知らせを開く' }).props['aria-describedby']).toBeUndefined();
});
