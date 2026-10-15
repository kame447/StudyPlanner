import { useEffect, useState } from 'react';
import { useMotionLevel } from '../hooks/useMotionPreference';

/** Two CSS-only layers: no canvas loop, media download, or per-frame React work. */
export function AuthStarfield() {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  // Ambient drift is decorative: only the standard motion level runs it.
  const reducedMotion = useMotionLevel() !== 'standard';
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const page = typeof document !== 'undefined' ? document : undefined;
    const onVisibility = () => setHidden(page?.visibilityState === 'hidden');
    page?.addEventListener('visibilitychange', onVisibility);
    return () => {
      page?.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <>
    <div className="auth-stars" aria-hidden="true" data-paused={hidden || reducedMotion || paused}>
      <div className="auth-stars__layer auth-stars__layer--far" />
      <div className="auth-stars__layer auth-stars__layer--near" />
    </div>
    {!reducedMotion ? <button
      type="button"
      className="auth-motion-toggle"
      aria-label={paused ? '星の動きを再開' : '星の動きを止める'}
      title={paused ? '星の動きを再開' : '星の動きを止める'}
      onClick={() => setPaused(value => !value)}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
        {paused ? <path d="M5 3.5 12 8l-7 4.5z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
      </svg>
    </button> : null}
  </>;
}
