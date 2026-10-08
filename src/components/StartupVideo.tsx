import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';

const MEDIA_WAIT_LIMIT_MS = 4_000;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function shouldShowStaticArtwork() {
  return (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    || (typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true);
}

/** Owns only decorative playback. Its static fallback is still a loading surface;
 * no media event or user gesture can release application readiness gates. */
export function StartupVideo({ src, poster, children }: PropsWithChildren<{ src: string; poster: string }>) {
  const [dismissed, setDismissed] = useState(shouldShowStaticArtwork);
  const videoRef = useRef<HTMLVideoElement>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWait = useCallback(() => {
    if (waitTimer.current !== null) clearTimeout(waitTimer.current);
    waitTimer.current = null;
  }, []);
  const dismiss = useCallback(() => {
    clearWait();
    setDismissed(true);
  }, [clearWait]);
  const allowMediaWait = useCallback(() => {
    // Repeated waiting/stalled events must not extend the same stalled interval.
    if (waitTimer.current !== null) return;
    waitTimer.current = setTimeout(dismiss, MEDIA_WAIT_LIMIT_MS);
  }, [dismiss]);

  useEffect(() => {
    if (dismissed) return;
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    const motion = typeof window !== 'undefined' ? window.matchMedia?.(REDUCED_MOTION_QUERY) : undefined;
    const page = typeof document !== 'undefined' ? document : undefined;
    const onMotionChange = (event: MediaQueryListEvent) => { if (event.matches) dismiss(); };
    const onVisibilityChange = () => { if (page?.visibilityState === 'hidden') dismiss(); };
    motion?.addEventListener?.('change', onMotionChange);
    page?.addEventListener('visibilitychange', onVisibilityChange);

    if (motion?.matches || page?.visibilityState === 'hidden') {
      dismiss();
    } else {
      allowMediaWait();
      // Set the DOM property as well as the JSX attribute before asking Safari
      // to play inline. Rejected autoplay is a static fallback, never an error gate.
      video.muted = true;
      // StrictMode can run setup again on the same element after cleanup has
      // removed its source. Do not reassign an already-current URL.
      if (video.getAttribute('src') !== src) video.setAttribute('src', src);
      try {
        const playing = video.play();
        void playing?.catch(() => { if (active) dismiss(); });
      } catch {
        dismiss();
      }
    }

    return () => {
      active = false;
      clearWait();
      motion?.removeEventListener?.('change', onMotionChange);
      page?.removeEventListener('visibilitychange', onVisibilityChange);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [allowMediaWait, clearWait, dismiss, dismissed, src]);

  if (dismissed) return <>{children}</>;

  return (
    <button
      type="button"
      className="startup-video"
      aria-label="起動アニメーションをスキップ"
      onClick={dismiss}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="startup-video__media"
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        onEnded={dismiss}
        onError={dismiss}
        onPlaying={clearWait}
        onWaiting={allowMediaWait}
        onStalled={allowMediaWait}
      />
      <span className="startup-video__hint" aria-hidden="true">タップしてスキップ</span>
    </button>
  );
}
