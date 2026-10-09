/** Change only the recorder switch, retaining even the spelling of other queries. */
export function startupTimingNavigationUrl(href: string, enabled: boolean): string {
  const url = new URL(href);
  const parts = url.search ? url.search.slice(1).split('&') : [];
  // A fragment may start with a literal '?'; it is a key character here.
  const retained = parts.filter(part => !new URLSearchParams(`&${part}`).has('startupTiming'));
  if (enabled) retained.push('startupTiming=1');
  url.search = retained.length ? `?${retained.join('&')}` : '';
  return url.href;
}

/** A full same-context reload initializes the import-time, in-memory recorder. */
export function reloadWithStartupTiming(enabled: boolean): void {
  window.location.replace(startupTimingNavigationUrl(window.location.href, enabled));
}
