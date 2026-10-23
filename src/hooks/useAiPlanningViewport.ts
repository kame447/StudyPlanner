import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Keep the chat and composer together when a mobile keyboard resizes/pans
 * only the visual viewport. Do not scroll the document or move input focus. */
export function useAiPlanningViewport(
  viewRef: RefObject<HTMLElement>,
  conversationRef: RefObject<HTMLElement>,
  active = true,
): void {
  const readerPosition = useRef<{ node: HTMLElement; top: number; followsEnd: boolean } | null>(null);
  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!active || !conversation) return;
    const saved = readerPosition.current;
    // Hidden completion can grow the transcript. Catch up only for someone who
    // was following the end; an older-message reader keeps their exact place.
    // This lifetime also applies when VisualViewport is unavailable.
    if (saved?.node === conversation) {
      conversation.scrollTop = saved.followsEnd ? conversation.scrollHeight : saved.top;
    }
    const rememberPosition = () => {
      readerPosition.current = { node: conversation, top: conversation.scrollTop,
        followsEnd: conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop <= 2 };
    };
    rememberPosition();
    conversation.addEventListener('scroll', rememberPosition, { passive: true });
    return () => { conversation.removeEventListener('scroll', rememberPosition); };
  }, [conversationRef, active]);

  useLayoutEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    const shell = viewRef.current?.closest<HTMLElement>('.app-shell.home-app-shell');
    if (!viewport || !shell) return;

    const properties = ['--ai-planning-viewport-height', '--ai-planning-viewport-top'];
    const previous = properties.map(name => ({
      name, value: shell.style.getPropertyValue(name), priority: shell.style.getPropertyPriority(name),
    }));
    let height = -1;
    let top = -1;
    let resumeFrame: number | null = null;

    const updateViewport = () => {
      if (document.visibilityState === 'hidden') return;
      // Pinch zoom must magnify the existing layout, not shrink/reflow it.
      if (viewport.scale !== 1 || viewport.height <= 0) return;
      const nextHeight = viewport.height;
      const nextTop = Math.max(0, viewport.offsetTop);
      if (height === nextHeight && top === nextTop) return;

      const conversation = conversationRef.current;
      const scrollTop = conversation?.scrollTop ?? 0;
      const atEnd = conversation
        ? conversation.scrollHeight - conversation.clientHeight - scrollTop <= 2
        : false;

      height = nextHeight;
      top = nextTop;
      shell.style.setProperty(properties[0], `${height}px`);
      shell.style.setProperty(properties[1], `${top}px`);

      // Read the resized scroll range after layout. Follow the latest message
      // only if the user was already there; leave older messages readable.
      if (conversation) conversation.scrollTop = atEnd ? conversation.scrollHeight : scrollTop;
    };

    const cancelResumeFrame = () => {
      if (resumeFrame === null) return;
      window.cancelAnimationFrame(resumeFrame);
      resumeFrame = null;
    };
    const resumeViewport = () => {
      if (document.visibilityState === 'hidden') {
        cancelResumeFrame();
        return;
      }
      if (resumeFrame !== null) return;
      // A background keyboard dismissal need not deliver a resize event.
      // Read at the next paint so an event-time stale size is not retained.
      resumeFrame = window.requestAnimationFrame(() => {
        resumeFrame = null;
        updateViewport();
      });
    };

    updateViewport();
    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    window.addEventListener('pageshow', resumeViewport);
    document.addEventListener('visibilitychange', resumeViewport);
    return () => {
      cancelResumeFrame();
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('pageshow', resumeViewport);
      document.removeEventListener('visibilitychange', resumeViewport);
      for (const { name, value, priority } of previous) {
        if (value) shell.style.setProperty(name, value, priority);
        else shell.style.removeProperty(name);
      }
    };
  }, [viewRef, conversationRef, active]);
}
