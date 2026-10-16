import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { AuthSessionService } from '../services/authSession';
import { ContactPage } from './ContactPage';
import { LegalPage } from './LegalPage';
import { createFakeAuthSession } from '../test/fakeAuthSession';

const body = vi.hoisted(() => {
  let release!: () => void;
  let started!: () => void;
  return { requested: vi.fn(), mounted: vi.fn(), starting: new Promise<void>(resolve => { started = resolve; }), started: () => started(), ready: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
});
vi.mock('./ContactPageContent', async () => {
  body.requested();
  body.started();
  await body.ready;
  return { ContactPageContent: ({ authSession }: { authSession?: AuthSessionService }) => {
    body.mounted(authSession);
    return <p data-testid="loaded-contact">contact body</p>;
  } };
});
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });

it('loads only on contact entry, keeps its shell, and does not mount a cancelled or old-session body', async () => {
  const oldSession = createFakeAuthSession().session;
  const currentSession = createFakeAuthSession().session;
  act(() => { renderer = create(<LegalPage kind="terms" />); });
  act(() => renderer.update(<LegalPage kind="privacy" />));
  expect(body.requested).not.toHaveBeenCalled();

  act(() => renderer.update(<>
    <ContactPage key="retained" authSession={oldSession} />
    <ContactPage key="cancelled" authSession={oldSession} />
  </>));
  await act(async () => { await body.starting; });
  expect(body.requested).toHaveBeenCalledOnce();
  expect(body.mounted).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('h1').map(node => node.children)).toEqual([['お問い合わせ'], ['お問い合わせ']]);
  expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(2);
  expect(renderer.root.findAllByProps({ role: 'status' }).every(node => node.props['aria-label'] === 'お問い合わせを読み込み中')).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('お問い合わせを読み込んでいます');
  const returnLink = renderer.root.findAllByProps({ className: 'legal-back-link' })[0];
  expect(returnLink.props.href).toBe('/');

  // Leave one page and change the retained page's auth service before delivery.
  act(() => renderer.update(<><ContactPage key="retained" authSession={currentSession} /></>));
  await act(async () => { body.release(); await vi.dynamicImportSettled(); });
  expect(body.mounted).toHaveBeenCalledOnce();
  expect(body.mounted).toHaveBeenCalledWith(currentSession);
  expect(renderer.root.findByProps({ className: 'legal-back-link' })).toBe(returnLink);
  expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ 'data-testid': 'loaded-contact' })).toHaveLength(1);
});
