import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { LaplanceAppRoot } from '../tests/e2e/harness/admin-entry-root.jsx';

vi.mock('../src/hooks/usePlannerAppState', () => ({ usePlannerAppState: () => ({}) }));
vi.mock('../src/App', () => ({ default: () => {
  const [draft, setDraft] = React.useState('initial');
  return <button onClick={() => setDraft('edited')}>{draft}</button>;
} }));

let renderer;
afterEach(() => { act(() => renderer?.unmount()); });

it('keeps same-owner drafts but retires state across null and different-owner notifications', () => {
  let listener;
  const unsubscribe = vi.fn();
  const session = { getCurrentUser: () => ({ id: 'a' }), subscribe(next) { listener = next; next({ id: 'a' }); return unsubscribe; } };
  act(() => { renderer = create(<LaplanceAppRoot authSession={session} />); });
  const draft = () => renderer.root.findByType('button');
  act(() => draft().props.onClick());
  act(() => listener({ id: 'a' }));
  expect(draft().children).toEqual(['edited']);
  act(() => listener(null));
  expect(draft().children).toEqual(['initial']);
  act(() => listener({ id: 'a' }));
  act(() => draft().props.onClick());
  act(() => listener({ id: 'b' }));
  expect(draft().children).toEqual(['initial']);
  act(() => draft().props.onClick());
  act(() => { listener(null); listener({ id: 'b' }); });
  expect(draft().children).toEqual(['initial']);
  act(() => renderer.unmount());
  expect(unsubscribe).toHaveBeenCalledOnce();
});
