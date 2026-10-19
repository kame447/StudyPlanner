import { createContext, useContext, type ComponentProps } from 'react';

export type PublicPagePath = '/contact' | '/terms' | '/privacy';
export function isPublicPagePath(path: string): path is PublicPagePath {
  return path === '/contact' || path === '/terms' || path === '/privacy';
}

export const PublicPageNavigationContext = createContext<{
  isPublicPage: boolean;
  navigate: (path: PublicPagePath | '/') => void;
} | null>(null);
export const usePublicPageNavigation = () => useContext(PublicPageNavigationContext);

/** Keep native new-tab, modified-click and standalone-page behavior. */
export function PublicPageLink({ onClick, href, ...props }: ComponentProps<'a'>) {
  const navigation = usePublicPageNavigation();
  return <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (!navigation || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (props.target && props.target !== '_self') || props.download !== undefined
      || !href || (href !== '/' && !isPublicPagePath(href))) return;
    event.preventDefault();
    navigation.navigate(href);
  }} />;
}
