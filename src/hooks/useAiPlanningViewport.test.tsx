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
  const window = Object.assign(new EventTarget(), { visualViewport: viewportAvailable ? viewport : null });
  vi.stubGlobal('window', window);
  const values = new Map<string, { value: string; priority: string }>();
  let position = 0;
  const conversation = {
    clientHeight: 600, scrollHeight: 2000,
    get scrollTop() { return position; },
    set scrollTop(value: number) { position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
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
  function Probe() {
    const viewRef = useRef<HTMLElement>(null);
    const conversationRef = useRef<HTMLDivElement>(null);
    useAiPlanningViewport(viewRef, conversationRef);
    return <section ref={viewRef}><div ref={conversationRef} /></section>;
  }
  return {
    viewport, window, conversation, style, values,
    mount() {
      act(() => { renderer = create(<Probe />, {
        createNodeMock: node => node.type === 'section' ? view : conversation,
      }); });
    },
    change(next: Partial<typeof viewport>, event = 'resize') {
      Object.assign(viewport, next);
      act(() => { viewport.dispatchEvent(new Event(event)); });
    },
  };
}

describe('AI planning visual viewport', () => {
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

  it.each([
    { viewportAvailable: false }, { shellAvailable: false },
  ])('retains the CSS fallback when the viewport API or app shell is absent: %j', options => {
    const b = browser(options); b.mount();
    expect(b.style.setProperty).not.toHaveBeenCalled();
  });
});
