import { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAiPlanningViewport } from './useAiPlanningViewport';

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function browser({ viewportAvailable = true, shellAvailable = true } = {}) {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const window = Object.assign(new EventTarget(), {
    visualViewport: viewportAvailable ? viewport : null,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const values = new Map<string, { value: string; priority: string }>();
  let position = 0;
  const scrollEvents = new EventTarget();
  const conversation = {
    addEventListener: scrollEvents.addEventListener.bind(scrollEvents),
    removeEventListener: scrollEvents.removeEventListener.bind(scrollEvents),
    clientHeight: 600, scrollHeight: 2000,
    get scrollTop() { return position; },
    set scrollTop(value: number) { position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); scrollEvents.dispatchEvent(new Event('scroll')); },
  };
  const style = {
    getPropertyValue: (name: string) => values.get(name)?.value ?? '',
    getPropertyPriority: (name: string) => values.get(name)?.priority ?? '',
    setProperty: vi.fn((name: string, value: string, priority = '') => {
      values.set(name, { value, priority });
      if (name === '--ai-planning-viewport-height') {
        conversation.clientHeight = Number.parseFloat(value) - 244;
        conversation.scrollTop = conversation.scrollTop;
      }
    }),
    removeProperty: vi.fn((name: string) => values.delete(name)),
  };
  const shell = { style };
  const view = { closest: () => shellAvailable ? shell : null };
  function Probe({ active = true }: { active?: boolean }) {
    const viewRef = useRef<HTMLElement>(null);
    const conversationRef = useRef<HTMLDivElement>(null);
    useAiPlanningViewport(viewRef, conversationRef, active);
    return <section ref={viewRef}><div ref={conversationRef} /></section>;
  }
  return {
    viewport, window, conversation, style, values, frames,
    visibility(state: 'hidden' | 'visible') {
      document.visibilityState = state;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    },
    pageShow() { act(() => { window.dispatchEvent(new Event('pageshow')); }); },
    paint() {
      const callbacks = [...frames.values()]; frames.clear();
      act(() => { callbacks.forEach(callback => callback(0)); });
    },
    mount() {
      act(() => { renderer = create(<Probe />, {
        createNodeMock: node => node.type === 'section' ? view : conversation,
      }); });
    },
    activate(active: boolean) { act(() => { renderer!.update(<Probe active={active} />); }); },
    change(next: Partial<typeof viewport>, event = 'resize') {
      Object.assign(viewport, next);
      act(() => { viewport.dispatchEvent(new Event(event)); });
    },
  };
}

describe('AI planning visual viewport', () => {
  it.each(['visibility', 'pageshow'] as const)
  ('remeasures on %s return without requiring a resize event', event => {
    const b = browser(); b.mount(); b.change({ height: 430, offsetTop: 80 });
    if (event === 'visibility') b.visibility('hidden');
    Object.assign(b.viewport, { height: 844, offsetTop: 0 });
    if (event === 'visibility') b.visibility('visible');
    else b.pageShow(); // Restored pages need not deliver visibilitychange.
    b.paint();
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('844px');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('0px');
  });

  it('reads resume geometry at the next frame, after an event-time stale value', () => {
    const b = browser(); b.mount(); b.change({ height: 430, offsetTop: 80 });
    b.visibility('hidden'); b.visibility('visible');
    // No subsequent resize is delivered after browser metrics settle.
    Object.assign(b.viewport, { height: 844, offsetTop: 0 });
    b.paint();
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('844px');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('0px');
  });

  it.each([true, false])('preserves the reader on resume (follows end: %s)', followsEnd => {
    const b = browser(); b.conversation.scrollTop = followsEnd ? 1400 : 340;
    b.mount(); b.change({ height: 430, offsetTop: 80 });
    b.visibility('hidden');
    Object.assign(b.viewport, { height: 844, offsetTop: 0 });
    b.visibility('visible'); b.paint();
    expect(b.conversation.scrollTop).toBe(followsEnd ? 1400 : 340);
  });

  it('does not mistake a real keyboard or pinch zoom on return for stale geometry', () => {
    const b = browser(); b.mount(); b.change({ height: 430, offsetTop: 80 });
    b.visibility('hidden'); b.visibility('visible'); b.paint();
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('430px');
    b.visibility('hidden');
    Object.assign(b.viewport, { height: 300, offsetTop: 140, scale: 1.5 });
    b.visibility('visible'); b.paint();
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('430px');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('80px');
    b.change({ height: 844, offsetTop: 0, scale: 1 });
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('844px');
  });

  it('coalesces repeated return signals into one read without polling', () => {
    const b = browser(); b.mount(); b.style.setProperty.mockClear();
    b.pageShow(); b.visibility('visible'); b.pageShow();
    expect(b.frames.size).toBe(1);
    expect(b.style.setProperty).not.toHaveBeenCalled();
    Object.assign(b.viewport, { height: 700 });
    b.paint();
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('700px');
    expect(b.frames.size).toBe(0);
  });

  it('cancels pending reads while hidden and ignores background geometry events', () => {
    const b = browser(); b.mount(); b.pageShow();
    b.visibility('hidden');
    expect(b.frames.size).toBe(0);
    b.style.setProperty.mockClear();
    b.change({ height: 430, offsetTop: 80 }); b.pageShow(); b.paint();
    expect(b.style.setProperty).not.toHaveBeenCalled();
    expect(b.frames.size).toBe(0);
    b.visibility('visible'); b.paint();
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('430px');
  });

  it.each(['inactive', 'unmount'] as const)('releases lifecycle listeners and pending frames on %s', end => {
    const b = browser(); b.mount(); b.pageShow();
    expect(b.frames.size).toBe(1);
    if (end === 'inactive') b.activate(false);
    else { act(() => renderer!.unmount()); renderer = undefined; }
    expect(b.frames.size).toBe(0);
    b.style.setProperty.mockClear();
    Object.assign(b.viewport, { height: 430 });
    b.pageShow(); b.visibility('visible'); b.paint();
    expect(b.frames.size).toBe(0);
    expect(b.style.setProperty).not.toHaveBeenCalled();
    expect(b.values.has('--ai-planning-viewport-height')).toBe(false);
    if (end === 'inactive') {
      b.activate(true);
      expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('430px');
      Object.assign(b.viewport, { height: 844 }); b.pageShow(); b.paint();
      expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('844px');
    }
  });

  it('keeps the latest conversation end visible through keyboard resize, pan and dismissal', () => {
    const b = browser();
    b.conversation.scrollTop = 1400;
    b.mount();
    b.change({ height: 430, offsetTop: 80 });
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('430px');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('80px');
    expect(b.conversation.scrollTop).toBe(1814);
    b.change({ offsetTop: 120 }, 'scroll');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('120px');
    expect(b.conversation.scrollTop).toBe(1814);
    b.change({ height: 844, offsetTop: 0 });
    expect(b.conversation.scrollTop).toBe(1400);
  });

  it('preserves a reader position rather than jumping to the end on focus/resize', () => {
    const b = browser();
    b.conversation.scrollTop = 340;
    b.mount();
    b.change({ height: 420, offsetTop: 60 });
    expect(b.conversation.scrollTop).toBe(340);
    // Reading farther back while the keyboard is open is never pinned.
    b.conversation.scrollTop = 120;
    b.change({ offsetTop: 90 }, 'scroll');
    expect(b.conversation.scrollTop).toBe(120);
    b.change({ height: 844, offsetTop: 0 });
    expect(b.conversation.scrollTop).toBe(120);
  });

  it('handles repeated resize events and rotation without modifying an unchanged layout', () => {
    const b = browser(); b.mount();
    b.style.setProperty.mockClear();
    b.change({});
    expect(b.style.setProperty).not.toHaveBeenCalled();
    Object.assign(b.viewport, { height: 390, offsetTop: 0 });
    act(() => { b.window.dispatchEvent(new Event('resize')); });
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('390px');
    b.change({ height: 844 });
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('844px');
  });

  it('leaves pinch-zoom geometry alone and resumes when the user zooms back out', () => {
    const b = browser(); b.mount(); b.style.setProperty.mockClear();
    b.change({ scale: 1.5, height: 560, offsetTop: 140 });
    b.change({ offsetTop: 210 }, 'scroll');
    expect(b.style.setProperty).not.toHaveBeenCalled();
    b.change({ scale: 1, height: 430, offsetTop: 20 });
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('430px');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('20px');
  });

  it('ignores a transient empty viewport and clamps negative overscroll', () => {
    const b = browser(); b.mount(); b.style.setProperty.mockClear();
    b.change({ height: 0 });
    expect(b.style.setProperty).not.toHaveBeenCalled();
    b.change({ height: 430, offsetTop: -20 });
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('0px');
  });

  it('removes all listeners and restores only owned geometry on unmount/navigation', () => {
    const b = browser();
    b.values.set('--ai-planning-viewport-height', { value: '700px', priority: 'important' });
    b.mount(); b.change({ height: 430, offsetTop: 40 });
    act(() => renderer!.unmount()); renderer = undefined;
    expect(b.values.get('--ai-planning-viewport-height')).toEqual({ value: '700px', priority: 'important' });
    expect(b.values.has('--ai-planning-viewport-top')).toBe(false);
    b.style.setProperty.mockClear(); b.style.removeProperty.mockClear();
    b.change({ height: 800 });
    b.change({ offsetTop: 10 }, 'scroll');
    act(() => { b.window.dispatchEvent(new Event('resize')); });
    expect(b.style.setProperty).not.toHaveBeenCalled();
    expect(b.style.removeProperty).not.toHaveBeenCalled();
  });

  it('releases viewport ownership while the mounted AI surface is inactive and reacquires current geometry', () => {
    const b = browser(); b.mount(); b.change({ height: 430, offsetTop: 40 });
    b.activate(false);
    expect(b.values.has('--ai-planning-viewport-height')).toBe(false);
    expect(b.values.has('--ai-planning-viewport-top')).toBe(false);
    b.style.setProperty.mockClear();
    b.change({ height: 700, offsetTop: 0 });
    expect(b.style.setProperty).not.toHaveBeenCalled();
    b.activate(true);
    expect(b.style.getPropertyValue('--ai-planning-viewport-height')).toBe('700px');
    expect(b.style.getPropertyValue('--ai-planning-viewport-top')).toBe('0px');
  });

  it.each([{ followsEnd: true, viewportAvailable: true }, { followsEnd: false, viewportAvailable: true },
    { followsEnd: true, viewportAvailable: false }, { followsEnd: false, viewportAvailable: false }])
  ('restores the visible reader bookmark after background growth: %j', ({ followsEnd, viewportAvailable }) => {
    const b = browser({ viewportAvailable }); b.conversation.scrollTop = followsEnd ? 1400 : 340; b.mount();
    b.activate(false);
    // No hidden event can replace the last visible bookmark.
    b.conversation.scrollHeight = 2600;
    b.conversation.scrollTop = 0;
    b.activate(true);
    expect(b.conversation.scrollTop).toBe(followsEnd ? 2000 : 340);
    b.activate(false); b.activate(true);
    expect(b.conversation.scrollTop).toBe(followsEnd ? 2000 : 340);
  });

  it.each([
    { viewportAvailable: false }, { shellAvailable: false },
  ])('retains the CSS fallback when the viewport API or app shell is absent: %j', options => {
    const b = browser(options); b.mount();
    expect(b.style.setProperty).not.toHaveBeenCalled();
  });
});
