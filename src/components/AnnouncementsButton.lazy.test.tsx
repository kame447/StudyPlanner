import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnouncementsButton } from './AnnouncementsButton';

const state = vi.hoisted(() => {
  let release!: () => void;
  return {
    ready: new Promise<void>((resolve) => { release = resolve; }),
    release: () => release(),
    navigation: { isOpen: false, detailId: null, open: vi.fn(), back: vi.fn() },
  };
});
vi.mock('../hooks/useAnnouncementsNavigation', () => ({ useAnnouncementsNavigation: () => state.navigation }));
vi.mock('./AnnouncementsPage', async (importOriginal) => {
  await state.ready;
  return importOriginal<typeof import('./AnnouncementsPage')>();
});
vi.mock('../services/announcementService', () => ({
  listAnnouncements: vi.fn(async () => ({ items: [], nextCursor: null })),
  getAnnouncementReadState: vi.fn(async () => ({ through: null, items: {} })),
  markAnnouncementRead: vi.fn(),
  markAllAnnouncementsRead: vi.fn(),
}));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it('keeps the bell unchanged while its page module loads, then opens the page normally', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible', body: {} }));
  const showModal = vi.fn();
  await act(async () => {
    renderer = create(<AnnouncementsButton userId="owner" />, {
      createNodeMock: () => ({ showModal, close() {}, querySelector: () => ({ focus() {} }) }),
    });
  });
  const closed = JSON.stringify(renderer.toJSON());
  const focus = vi.fn();
  act(() => renderer.root.findByProps({ 'aria-label': 'お知らせを開く' }).props.onClick({ currentTarget: { focus } }));
  expect(state.navigation.open).toHaveBeenCalledExactlyOnceWith();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  state.navigation.isOpen = true;
  await act(async () => renderer.update(<AnnouncementsButton userId="owner" />));
  const pending = JSON.stringify(renderer.toJSON());
  expect(showModal).not.toHaveBeenCalled();

  await act(async () => { state.release(); });
  await vi.waitFor(() => expect(showModal).toHaveBeenCalledOnce());
  expect(renderer.root.findByType('h1').children).toEqual(['お知らせ一覧']);
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  act(() => renderer.root.findByProps({ 'aria-label': 'ホームへ戻る' }).props.onClick());
  expect(state.navigation.back).toHaveBeenCalledOnce();
  expect(pending).toEqual(closed);
});
