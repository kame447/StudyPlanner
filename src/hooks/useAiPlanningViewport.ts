import { useLayoutEffect, type RefObject } from 'react';

/** Keep the chat and composer together when a mobile keyboard resizes/pans
 * only the visual viewport. Do not scroll the document or move input focus. */
export function useAiPlanningViewport(
  viewRef: RefObject<HTMLElement>,
  conversationRef: RefObject<HTMLElement>,
): void {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const shell = viewRef.current?.closest<HTMLElement>('.app-shell.home-app-shell');
    if (!viewport || !shell) return;

    const properties = ['--ai-planning-viewport-height', '--ai-planning-viewport-top'];
    const previous = properties.map(name => ({
      name, value: shell.style.getPropertyValue(name), priority: shell.style.getPropertyPriority(name),
    }));
    let height = -1;
    let top = -1;

    const updateViewport = () => {
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

    updateViewport();
    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      for (const { name, value, priority } of previous) {
        if (value) shell.style.setProperty(name, value, priority);
        else shell.style.removeProperty(name);
      }
    };
  }, [viewRef, conversationRef]);
}
