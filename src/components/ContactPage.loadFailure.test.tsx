import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ContactPage } from './ContactPage';

vi.mock('./ContactPageContent', async () => { throw new Error('simulated chunk delivery failure'); });
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps return navigation and offers a real reload when the optional chunk fails', async () => {
  const reload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { renderer = create(<ContactPage />); await vi.dynamicImportSettled(); });
  expect(renderer.root.findByType('h1').children).toEqual(['お問い合わせ']);
  expect(renderer.root.findByProps({ className: 'legal-back-link' }).props.href).toBe('/');
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('読み込めませんでした');
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
  act(() => renderer.root.findByType('button').props.onClick());
  expect(reload).toHaveBeenCalledOnce();
});
