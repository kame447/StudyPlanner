import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnouncementsButton } from './AnnouncementsButton';

const delivery = vi.hoisted(() => {
  let start!: () => void, fail!: () => void;
  return { starting: new Promise<void>(resolve => { start = resolve; }), start: () => start(),
    pending: new Promise<void>(resolve => { fail = resolve; }), fail: () => fail() };
});
vi.mock('./AnnouncementsPage', async () => { delivery.start(); await delivery.pending; throw new Error('late announcement delivery failure'); });
vi.mock('../services/announcementService', () => ({ listAnnouncements: vi.fn(async () => ({ items: [], nextCursor: null })), getAnnouncementReadState: vi.fn(async () => ({ through: null, items: {} })) }));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('ignores delivery after pending Back or owner change and scopes cached failure to the reopened owner', async () => {
  const entries: Record<string, unknown>[] = [{}]; let index = 0;
  const browser = Object.assign(new EventTarget(), {
    history: { get state() { return entries[index]; }, get length() { return entries.length; },
      pushState(state: Record<string, unknown>) { entries.splice(index + 1); entries.push(state); index++; },
      replaceState(state: Record<string, unknown>) { entries[index] = state; }, back: vi.fn() },
  });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { body: {}, visibilityState: 'visible' }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const showModal = vi.fn(), close = vi.fn(), focus = vi.fn();
  const open = () => renderer.root.findByProps({ 'aria-label': 'お知らせを開く' }).props.onClick({ currentTarget: { focus } });
  const render = (owner: string) => <main><p>Home</p><AnnouncementsButton userId={owner} /></main>;
  await act(async () => { renderer = create(render('first'), {
    createNodeMock: element => element.type === 'dialog' ? { showModal, close } : element.type === 'button' ? { focus } : null,
  }); });
  await act(async () => { open(); await delivery.starting; });
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('読み込んでいます');
  act(() => renderer.update(render('second')));
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  act(open);
  const secondEntry = index;
  act(() => { index = 0; browser.dispatchEvent(new Event('popstate')); });
  await act(async () => { delivery.fail(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(showModal).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Home');
  await act(async () => { index = secondEntry; browser.dispatchEvent(new Event('popstate')); });
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['お知らせを読み込めませんでした。']);
  expect(showModal).toHaveBeenCalledOnce();
  act(() => renderer.update(render('first')));
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(close).toHaveBeenCalledOnce();
});
