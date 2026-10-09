import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';

const MEDIA_WAIT_LIMIT_MS = 4_000;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export type StartupVideoOutcome = 'ended' | 'skipped' | 'reduced-motion' | 'autoplay-blocked' | 'media-error' | 'stalled';
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;

/** Owns media outcomes, never application readiness. Hidden playback is paused, not completed. */
export function StartupVideo({ src, poster, canSkip = false, onComplete, children }: PropsWithChildren<{
  src: string; poster: string; canSkip?: boolean; onComplete?: (reason: StartupVideoOutcome) => boolean | void;
}>) {
  const [initialReducedMotion] = useState(reducedMotion);
  const [outcome, setOutcome] = useState<StartupVideoOutcome | null>(initialReducedMotion ? 'reduced-motion' : null);
  const outcomeNow = useRef(outcome);
  const reportOutcome = useRef(onComplete);
  reportOutcome.current = onComplete;
  const [hasBeenVisible, setHasBeenVisible] = useState(() => !isHidden());
  const videoRef = useRef<HTMLVideoElement>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watching = useRef(false);
  const lastProgress = useRef(0);
  const skipAllowed = useRef(canSkip);
  skipAllowed.current = canSkip;
  const clearWait = useCallback(() => {
    if (waitTimer.current !== null) clearTimeout(waitTimer.current);
    waitTimer.current = null;
  }, []);
  const finish = useCallback((reason: StartupVideoOutcome) => {
    if (outcomeNow.current || reportOutcome.current?.(reason) === false) return;
    outcomeNow.current = reason;
    watching.current = false;
    clearWait();
    setOutcome(reason);
  }, [clearWait]);
  const allowMediaWait = useCallback(() => {
    if (!watching.current || waitTimer.current !== null) return;
    waitTimer.current = setTimeout(() => finish('stalled'), MEDIA_WAIT_LIMIT_MS);
  }, [finish]);
  const observeProgress = useCallback(() => {
    if (!watching.current) return;
    const time = videoRef.current?.currentTime ?? 0;
    if (time > lastProgress.current) {
      lastProgress.current = time;
      clearWait();
    }
    allowMediaWait();
  }, [allowMediaWait, clearWait]);
  const skip = useCallback(() => { if (skipAllowed.current) finish('skipped'); }, [finish]);

  useEffect(() => { if (initialReducedMotion) reportOutcome.current?.('reduced-motion'); }, [initialReducedMotion]);
  useEffect(() => {
    const motion = typeof window !== 'undefined' ? window.matchMedia?.(REDUCED_MOTION_QUERY) : undefined;
    const page = typeof document !== 'undefined' ? document : undefined;
    const onMotion = (event: MediaQueryListEvent) => { if (event.matches) finish('reduced-motion'); };
    const onVisible = () => { if (!isHidden()) setHasBeenVisible(true); };
    motion?.addEventListener?.('change', onMotion);
    page?.addEventListener('visibilitychange', onVisible);
    return () => { motion?.removeEventListener?.('change', onMotion); page?.removeEventListener('visibilitychange', onVisible); };
  }, [finish]);

  useEffect(() => {
    const video = videoRef.current;
    if (outcome || !hasBeenVisible || !video) return;
    let active = true;
    let attempt = 0;
    const play = () => {
      const currentAttempt = ++attempt;
      if (isHidden()) return;
      watching.current = true;
      lastProgress.current = video.currentTime || 0;
      allowMediaWait();
      video.muted = true;
      if (video.getAttribute('src') !== src) video.setAttribute('src', src);
      try {
        void video.play()?.catch(() => {
          if (active && currentAttempt === attempt && !isHidden()) finish('autoplay-blocked');
        });
      } catch { if (active && currentAttempt === attempt) finish('autoplay-blocked'); }
    };
    const onVisibility = () => {
      if (isHidden()) {
        ++attempt;
        watching.current = false;
        clearWait();
        video.pause();
      } else play();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    play();
    return () => {
      active = false; ++attempt;
      watching.current = false;
      clearWait();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      video.pause(); video.removeAttribute('src'); video.load();
    };
  }, [allowMediaWait, clearWait, finish, hasBeenVisible, outcome, src]);

  if (outcome || !hasBeenVisible) return <>{children}</>;
  return <button type="button" className="startup-video" disabled={!canSkip}
    aria-label={canSkip ? '起動アニメーションをスキップ' : '起動アニメーション'}
    style={!canSkip ? { opacity: 1, cursor: 'default' } : undefined}
    onClick={skip} onKeyDown={event => { if (event.key === 'Escape' && skipAllowed.current) { event.preventDefault(); skip(); } }}>
    <video ref={videoRef} src={src} poster={poster} className="startup-video__media"
      autoPlay muted playsInline preload="auto" aria-hidden="true" tabIndex={-1}
      onEnded={() => finish('ended')} onError={() => finish('media-error')}
      onPlaying={observeProgress} onTimeUpdate={observeProgress} onWaiting={allowMediaWait} onStalled={allowMediaWait} onPause={allowMediaWait} />
    {canSkip ? <span className="startup-video__hint" aria-hidden="true">タップしてスキップ</span> : null}
  </button>;
}
