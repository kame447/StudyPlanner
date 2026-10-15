import { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMaterialCreateViewport } from './useMaterialCreateViewport';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

function setup(active = true, hasViewport = true) {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const window = Object.assign(new EventTarget(), { visualViewport: hasViewport ? viewport : null });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  const values = new Map<string, string>();
  const overlay = { style: { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) } };
  function Probe({ enabled = active }) {
    const ref = useRef<HTMLDivElement>(null);
    useMaterialCreateViewport(ref, enabled);
    return <div ref={ref} />;
  }
  act(() => { renderer = create(<Probe />, { createNodeMock: () => overlay }); });
  return { viewport, window, document, values, deactivate: () => act(() => renderer!.update(<Probe enabled={false} />)) };
}

describe('material creation visual viewport', () => {
  it('tracks keyboard resize/pan, ignores pinch zoom and clears its own styles/listeners', () => {
    const b = setup();
    expect(b.values.get('--material-create-viewport-height')).toBe('844px');
    Object.assign(b.viewport, { height: 400, offsetTop: 40 });
    b.viewport.dispatchEvent(new Event('resize'));
    expect(b.values.get('--material-create-viewport-height')).toBe('400px');
    expect(b.values.get('--material-create-viewport-top')).toBe('40px');
    Object.assign(b.viewport, { height: 200, scale: 2, offsetTop: 80 });
    b.viewport.dispatchEvent(new Event('scroll'));
    expect(b.values.get('--material-create-viewport-height')).toBe('400px');
    b.deactivate();
    expect(b.values.size).toBe(0);
    Object.assign(b.viewport, { height: 844, scale: 1 });
    b.viewport.dispatchEvent(new Event('resize'));
    expect(b.values.size).toBe(0);
  });

  it.each(['pageshow', 'visibilitychange'])('recovers the current dimensions on %s', event => {
    const b = setup();
    b.document.visibilityState = 'hidden'; b.viewport.height = 400;
    b.viewport.dispatchEvent(new Event('resize'));
    expect(b.values.get('--material-create-viewport-height')).toBe('844px');
    b.document.visibilityState = 'visible';
    (event === 'pageshow' ? b.window : b.document).dispatchEvent(new Event(event));
    expect(b.values.get('--material-create-viewport-height')).toBe('400px');
  });

  it.each([[false, true], [true, false]])('does not change edit dialogs or unsupported browsers', (active, available) => {
    expect(setup(active, available).values.size).toBe(0);
  });
});
