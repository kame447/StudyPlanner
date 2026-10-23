import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readStartupDeliveryTiming, STARTUP_ASSET_ROLES } from './startupDeliveryTiming';

const origin = 'https://startup.example.test';
const filenames = ['index-Ab_c1.js', 'vendor-react-Ab_c1.js', 'vendor-firebase-Ab_c1.js',
  'vendor-runtime-Ab_c1.js', 'vendor-icons-Ab_c1.js', 'index-Ab_c1.css'];
const resource = (filename: string, responseEnd = 80) => ({ name: `${origin}/assets/${filename}`,
  startTime: 20, responseEnd, transferSize: 150, encodedBodySize: 100, decodedBodySize: 300 });
const navigation = () => ({ name: `${origin}/private?token=private-account`,
  fetchStart: 1, requestStart: 4, responseStart: 10, responseEnd: 15 });
let nav: unknown[];
let resources: unknown[];
let read: ReturnType<typeof vi.fn>;
beforeEach(() => {
  nav = [navigation()]; resources = filenames.map((name, index) => resource(name, 70 + index));
  read = vi.fn((type: string) => type === 'navigation' ? nav : resources);
  vi.stubGlobal('performance', { getEntriesByType: read });
  vi.stubGlobal('window', { location: { origin } });
});
afterEach(() => vi.unstubAllGlobals());

it('separates document delivery, six initial asset responses and the inferred pre-Splash gap', () => {
  const sample = readStartupDeliveryTiming(120);
  expect(sample.navigation).toEqual({ fetchStartMs: 1, requestStartMs: 4, responseStartMs: 10, responseEndMs: 15 });
  expect(sample.assets.map(asset => asset.role)).toEqual(STARTUP_ASSET_ROLES);
  expect(sample.assets[0]).toEqual({ role: 'entry-script', status: 'observed', startMs: 20,
    responseEndMs: 70, transferBytes: 150, encodedBytes: 100, decodedBytes: 300 });
  expect(sample.splashMountedMs).toBe(120);
  expect(sample.deliveryToSplashGapMs).toBe(45);
  expect(read.mock.calls).toEqual([['navigation'], ['resource']]);
});

it('includes HTML response completion when streamed assets arrive before the HTML finishes', () => {
  nav = [{ ...navigation(), responseEnd: 100 }];
  expect(readStartupDeliveryTiming(120).deliveryToSplashGapMs).toBe(20);
});

it('retains an actually measured zero residual without inventing missing byte values', () => {
  resources = filenames.map(name => ({ ...resource(name, 100), transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }));
  const sample = readStartupDeliveryTiming(100);
  expect(sample.deliveryToSplashGapMs).toBe(0);
  expect(sample.assets.every(asset => asset.transferBytes === null && asset.encodedBytes === null && asset.decodedBytes === null)).toBe(true);
});

it.each([null, NaN, Infinity, -1])('does not infer a gap or inspect assets without a usable Splash mark: %s', splash => {
  const sample = readStartupDeliveryTiming(splash);
  expect(sample.splashMountedMs).toBeNull();
  expect(sample.deliveryToSplashGapMs).toBeNull();
  expect(sample.assets.every(asset => asset.status === 'unavailable')).toBe(true);
  expect(read).toHaveBeenCalledExactlyOnceWith('navigation');
});

it('excludes optional, external, credentialed, query-bearing and private resources without retaining any URL', () => {
  resources.push(...[
    resource('AiPlanningView-abc.js'), resource('index-abc.js?account=private-account'), resource('index-abc.js#private-account'),
    { ...resource('index-abc.js'), name: 'https://third-party.example.test/assets/index-abc.js' },
    { ...resource('index-abc.js'), name: 'https://private-account:secret@startup.example.test/assets/index-abc.js' },
    { ...resource('index-abc.js'), name: `${origin}/users/private-account/profile` },
    { ...resource('index-abc.js'), name: 'not a URL private-account' },
    resource('vendor-react-abc.css'),
  ]);
  const sample = readStartupDeliveryTiming(120);
  expect(sample.assets.every(asset => asset.status === 'observed')).toBe(true);
  expect(JSON.stringify(sample)).not.toMatch(/https|private-account|secret|token|AiPlanningView|name|url/i);
  expect(Object.keys(sample)).toEqual(['navigation', 'assets', 'splashMountedMs', 'deliveryToSplashGapMs']);
  for (const asset of sample.assets) expect(Object.keys(asset)).toEqual([
    'role', 'status', 'startMs', 'responseEndMs', 'transferBytes', 'encodedBytes', 'decodedBytes',
  ]);
});

it('ignores entries that complete after Splash instead of using later reloads or preloads', () => {
  resources.push(resource(filenames[0], 500));
  expect(readStartupDeliveryTiming(120).deliveryToSplashGapMs).toBe(45);
  resources[0] = resource(filenames[0], 500);
  expect(readStartupDeliveryTiming(120).assets[0].status).toBe('unavailable');
  expect(readStartupDeliveryTiming(120).deliveryToSplashGapMs).toBeNull();
});

it('does not choose a convenient winner among repeated initial-role entries', () => {
  resources.push(resource(filenames[0], 90), resource('index-OtherHash.js', 95));
  const sample = readStartupDeliveryTiming(120);
  expect(sample.assets[0]).toEqual({ role: 'entry-script', status: 'ambiguous', startMs: null,
    responseEndMs: null, transferBytes: null, encodedBytes: null, decodedBytes: null });
  expect(sample.deliveryToSplashGapMs).toBeNull();
});

it.each([{ entries: [] }, { entries: [{ ...navigation(), responseEnd: 0 }] }, { entries: [{ ...navigation(), responseEnd: Infinity }] }])(
  'leaves missing or unfinished navigation unknown while retaining asset observations', ({ entries }) => {
    nav = entries;
    const sample = readStartupDeliveryTiming(120);
    expect(sample.navigation).toBeNull();
    expect(sample.assets.every(asset => asset.status === 'observed')).toBe(true);
    expect(sample.deliveryToSplashGapMs).toBeNull();
  },
);

it('does not subtract a document response later than the observed Splash', () => {
  nav = [{ ...navigation(), responseEnd: 130 }];
  expect(readStartupDeliveryTiming(120).deliveryToSplashGapMs).toBeNull();
});

it('keeps missing/zero navigation milestones unknown and a zero fetchStart valid', () => {
  nav = [{ ...navigation(), fetchStart: 0, requestStart: 0, responseStart: undefined }];
  expect(readStartupDeliveryTiming(120).navigation).toEqual({ fetchStartMs: 0, requestStartMs: null, responseStartMs: null, responseEndMs: 15 });
});

it.each([{ startTime: -1 }, { startTime: NaN }, { responseEnd: 0 }, { responseEnd: NaN },
  { responseEnd: Infinity }, { startTime: 90, responseEnd: 80 }])('refuses unusable resource timing: %s', invalid => {
  resources[0] = { ...resource(filenames[0]), ...invalid };
  const sample = readStartupDeliveryTiming(120);
  expect(sample.assets[0].status).toBe('unavailable');
  expect(sample.deliveryToSplashGapMs).toBeNull();
});

it('does not convert malformed byte counters into valid sizes', () => {
  resources[0] = { ...resource(filenames[0]), transferSize: -1, encodedBodySize: Infinity, decodedBodySize: 1.5 };
  expect(readStartupDeliveryTiming(120).assets[0]).toMatchObject({ status: 'observed', transferBytes: null, encodedBytes: null, decodedBytes: null });
});

it.each(['navigation', 'resource'])('tolerates unavailable %s APIs without leaking raw errors', failedType => {
  read.mockImplementation((type: string) => {
    if (type === failedType) throw new Error('private-account failure');
    return type === 'navigation' ? nav : resources;
  });
  const sample = readStartupDeliveryTiming(120);
  expect(sample.deliveryToSplashGapMs).toBeNull();
  expect(sample.navigation !== null).toBe(failedType !== 'navigation');
  expect(sample.assets.every(asset => asset.status === 'observed')).toBe(failedType !== 'resource');
  expect(JSON.stringify(sample)).not.toContain('private-account');
});

it('reports unavailable entries on unsupported browsers and outside a browser', () => {
  vi.stubGlobal('performance', {});
  vi.stubGlobal('window', undefined);
  expect(readStartupDeliveryTiming(120)).toEqual({ navigation: null, splashMountedMs: 120,
    deliveryToSplashGapMs: null, assets: STARTUP_ASSET_ROLES.map(role => ({ role, status: 'unavailable',
      startMs: null, responseEndMs: null, transferBytes: null, encodedBytes: null, decodedBytes: null })) });
});

it('reads entries without requests, storage, observers or changing the timing buffer', () => {
  const forbidden = vi.fn(() => { throw new Error('unexpected side effect'); });
  vi.stubGlobal('fetch', forbidden);
  vi.stubGlobal('localStorage', { getItem: forbidden, setItem: forbidden });
  vi.stubGlobal('sessionStorage', { getItem: forbidden, setItem: forbidden });
  vi.stubGlobal('navigator', { sendBeacon: forbidden });
  vi.stubGlobal('PerformanceObserver', forbidden);
  vi.stubGlobal('performance', { getEntriesByType: read, clearResourceTimings: forbidden, setResourceTimingBufferSize: forbidden });
  const sample = readStartupDeliveryTiming(120);
  expect(sample.deliveryToSplashGapMs).toBe(45);
  expect(forbidden).not.toHaveBeenCalled();
  (resources[0] as { responseEnd: number }).responseEnd = 119;
  expect(sample.assets[0].responseEndMs).toBe(70);
});
