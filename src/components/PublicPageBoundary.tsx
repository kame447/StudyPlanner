import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useThemePreference } from '../hooks/useThemePreference';
import { APP_HISTORY_CHANGE, subscribeAppHistory } from '../lib/appHistory';
import { withoutSettingsHistory } from '../hooks/useSettingsNavigation';
import { LegalPage } from './LegalPage';
import { isPublicPagePath, PublicPageNavigationContext, usePublicPageNavigation } from './PublicPageLink';
import '../styles/public-page-navigation.css';

/** Root and standalone App share one URL owner above authentication and startup. */
export function PublicPageBoundary({ children }: PropsWithChildren) {
  return usePublicPageNavigation() ? <>{children}</> : <PublicPageOwner>{children}</PublicPageOwner>;
}

function InitialPublicPageTheme() {
  useThemePreference();
  return null;
}

function PublicPageOwner({ children }: PropsWithChildren) {
  const [path, setPath] = useState(() => typeof window === 'undefined' ? '/' : window.location.pathname);
  const isPublicPage = isPublicPagePath(path);
  const [plannerStarted, setPlannerStarted] = useState(!isPublicPage);
  const publicSurface = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const previouslyPublic = useRef(isPublicPage);
  useEffect(() => subscribeAppHistory(() => {
    const next = window.location.pathname;
    if (isPublicPagePath(next) && !isPublicPage && typeof document !== 'undefined') {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setPath(next);
  }), [isPublicPage]);
  useEffect(() => { if (!isPublicPage) setPlannerStarted(true); }, [isPublicPage]);
  const navigate = useCallback((next: '/contact' | '/terms' | '/privacy' | '/') => {
    if (window.location.pathname === next) return;
    // Public pages retain their origin's settings entry; explicit Home return
    // starts a clean entry. The settings owner handles its own history marker.
    window.history.pushState(next === '/' ? withoutSettingsHistory(window.history.state) : window.history.state, '', next);
    window.dispatchEvent(new Event(APP_HISTORY_CHANGE));
  }, []);
  const navigation = useMemo(() => ({ isPublicPage, navigate }), [isPublicPage, navigate]);

  useLayoutEffect(() => {
    if (isPublicPage) {
      publicSurface.current?.scrollTo(0, 0);
      publicSurface.current?.querySelector<HTMLElement>('.legal-back-link')?.focus({ preventScroll: true });
    } else if (previouslyPublic.current) {
      const target = returnFocus.current;
      if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
      returnFocus.current = null;
    }
    previouslyPublic.current = isPublicPage;
  }, [path, isPublicPage]);

  return <PublicPageNavigationContext.Provider value={navigation}>
    {!plannerStarted && isPublicPage && <InitialPublicPageTheme />}
    {(plannerStarted || !isPublicPage) && <div className="public-page-planner" hidden={isPublicPage}>{children}</div>}
    {isPublicPage && <div key={path} className="public-page-surface" ref={publicSurface} tabIndex={-1}>
      <LegalPage kind={path.slice(1) as 'contact' | 'terms' | 'privacy'} />
    </div>}
  </PublicPageNavigationContext.Provider>;
}
