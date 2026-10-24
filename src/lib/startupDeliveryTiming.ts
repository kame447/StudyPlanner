/** Passive projection of buffered browser entries. Never retain URLs or raw entries. */
export const STARTUP_ASSET_ROLES = [
  'entry-script', 'react-vendor', 'firebase-vendor', 'runtime-vendor', 'icons-vendor', 'entry-styles',
] as const;
type AssetRole = typeof STARTUP_ASSET_ROLES[number];
interface AssetTiming {
  role: AssetRole;
  status: 'observed' | 'unavailable' | 'ambiguous';
  startMs: number | null;
  responseEndMs: number | null;
  transferBytes: number | null;
  encodedBytes: number | null;
  decodedBytes: number | null;
}
export interface StartupDeliveryTimingSnapshot {
  navigation: {
    fetchStartMs: number | null;
    requestStartMs: number | null;
    responseStartMs: number | null;
    responseEndMs: number;
  } | null;
  assets: AssetTiming[];
  splashMountedMs: number | null;
  deliveryToSplashGapMs: number | null;
}

const assetRoles: Record<string, AssetRole> = {
  'index.js': 'entry-script', 'vendor-react.js': 'react-vendor',
  'vendor-firebase.js': 'firebase-vendor', 'vendor-runtime.js': 'runtime-vendor',
  'vendor-icons.js': 'icons-vendor', 'index.css': 'entry-styles',
};
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0 ? value : null;
const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : null;
// A zero byte counter does not establish a cache layer or a zero-byte response.
const bytes = (value: number) => Number.isSafeInteger(value) && value > 0 ? value : null;
const unavailable = (role: AssetRole): AssetTiming => ({ role, status: 'unavailable',
  startMs: null, responseEndMs: null, transferBytes: null, encodedBytes: null, decodedBytes: null });

function assetRole(name: string, origin: string): AssetRole | undefined {
  try {
    const url = new URL(name);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return;
    // Current Vite initial graph only; optional views, media, API and user URLs are excluded.
    const match = /^\/assets\/(index|vendor-react|vendor-firebase|vendor-runtime|vendor-icons)-[\w-]+\.(js|css)$/.exec(url.pathname);
    return match ? assetRoles[`${match[1]}.${match[2]}`] : undefined;
  } catch { return; }
}

/** Called only inside the already opt-in and authorized diagnostic presentation. */
export function readStartupDeliveryTiming(splashStartMs: number | null): StartupDeliveryTimingSnapshot {
  const splashMountedMs = splashStartMs === null ? null : nonnegative(splashStartMs);
  const snapshot: StartupDeliveryTimingSnapshot = {
    navigation: null, assets: STARTUP_ASSET_ROLES.map(unavailable), splashMountedMs, deliveryToSplashGapMs: null,
  };
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (entry && positive(entry.responseEnd) !== null) {
      snapshot.navigation = { fetchStartMs: nonnegative(entry.fetchStart), requestStartMs: positive(entry.requestStart),
        responseStartMs: positive(entry.responseStart), responseEndMs: entry.responseEnd };
    }
  } catch { /* Unsupported or unavailable entries remain unknown. */ }
  if (splashMountedMs === null) return snapshot;
  try {
    const origin = window.location.origin;
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const role = assetRole(entry.name, origin);
      if (!role || nonnegative(entry.startTime) === null || positive(entry.responseEnd) === null
        || entry.responseEnd < entry.startTime || entry.responseEnd > splashMountedMs) continue;
      const index = STARTUP_ASSET_ROLES.indexOf(role);
      const previous = snapshot.assets[index];
      snapshot.assets[index] = previous.status === 'unavailable'
        ? { role, status: 'observed', startMs: entry.startTime, responseEndMs: entry.responseEnd,
          transferBytes: bytes(entry.transferSize), encodedBytes: bytes(entry.encodedBodySize), decodedBytes: bytes(entry.decodedBodySize) }
        : { ...unavailable(role), status: 'ambiguous' };
    }
  } catch { snapshot.assets = STARTUP_ASSET_ROLES.map(unavailable); }
  // This is an inferred residual after tracked delivery, not CPU time or first paint.
  if (snapshot.navigation && snapshot.assets.every(asset => asset.status === 'observed')) {
    const end = Math.max(snapshot.navigation.responseEndMs, ...snapshot.assets.map(asset => asset.responseEndMs!));
    if (end <= splashMountedMs) snapshot.deliveryToSplashGapMs = splashMountedMs - end;
  }
  return snapshot;
}
