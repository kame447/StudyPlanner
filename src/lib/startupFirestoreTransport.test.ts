import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { firestoreTransportSettings, resolveStartupFirestoreTransport } from './startupFirestoreTransport';

const firebase = vi.hoisted(() => ({ app: {}, db: {}, initializeApp: vi.fn(), initializeFirestore: vi.fn() }));
vi.mock('firebase/app', () => ({ initializeApp: firebase.initializeApp }));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(), GoogleAuthProvider: vi.fn() }));
vi.mock('firebase/firestore', () => ({ initializeFirestore: firebase.initializeFirestore }));
vi.mock('./firebaseConfig', () => ({ getFirebaseConfig: () => ({ enabled: true, apiKey: 'synthetic', authDomain: 'example.test', projectId: 'synthetic', appId: 'synthetic' }) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  firebase.initializeApp.mockReturnValue(firebase.app); firebase.initializeFirestore.mockReturnValue(firebase.db);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('selector must not make requests'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

it('accepts only one explicit diagnostic flag and one allowlisted transport', () => {
  const cases = [
    ['', 'forced'], ['?startupTransport=auto', 'forced'],
    ['?startupTiming=0&startupTransport=auto', 'forced'], ['?startupTiming=true&startupTransport=auto', 'forced'],
    ['?startupTiming=1', 'forced'], ['?startupTiming=1&startupTransport=forced', 'forced'],
    ['?startupTiming=1&startupTransport=auto', 'auto'], ['?startupTiming=1&startupTransport=streaming', 'streaming'],
    ['?startupTiming=1&startupTransport=unknown', 'forced'], ['?startupTiming=1&startupTransport=__proto__', 'forced'],
    ['?startupTiming=1&startupTransport=AUTO', 'forced'], ['?startupTiming=1&startupTransport=%E0%A4%A', 'forced'],
    ['?startupTiming=1&startupTransport=auto&startupTransport=streaming', 'forced'],
    ['?startupTiming=1&startupTiming=1&startupTransport=auto', 'forced'],
    ['?startupTiming=1&startupTransport=auto&startup%54ransport=auto', 'forced'],
  ];
  for (const [query, expected] of cases) expect(resolveStartupFirestoreTransport(query), query).toBe(expected);
});
it('preserves the exact default and uses mutually compatible public SDK flags', () => {
  expect(firestoreTransportSettings('forced')).toEqual({ experimentalForceLongPolling: true });
  expect(firestoreTransportSettings('auto')).toEqual({ experimentalForceLongPolling: false, experimentalAutoDetectLongPolling: true });
  expect(firestoreTransportSettings('streaming')).toEqual({ experimentalForceLongPolling: false, experimentalAutoDetectLongPolling: false });
});
it.each(['forced', 'auto', 'streaming'] as const)('initializes Firestore once with the displayed %s choice and never persists it', async mode => {
  const browser = { location: { search: `?startupTiming=1&startupTransport=${mode}` },
    get localStorage(): never { throw new Error('storage forbidden'); }, get sessionStorage(): never { throw new Error('storage forbidden'); } };
  vi.stubGlobal('window', browser);
  const selected = await import('./startupFirestoreTransport');
  const client = await import('./firebaseClient');
  expect(selected.startupFirestoreTransport).toBe(mode);
  expect(client.getFirestoreDb()).toBe(firebase.db);
  browser.location.search = '?startupTiming=1&startupTransport=unknown';
  expect(client.getFirestoreDb()).toBe(firebase.db);
  expect(selected.startupFirestoreTransport).toBe(mode);
  expect(firebase.initializeFirestore).toHaveBeenCalledExactlyOnceWith(firebase.app, firestoreTransportSettings(mode));
  expect(fetch).not.toHaveBeenCalled();
});
it('fails safe without a browser or when location access throws', async () => {
  vi.stubGlobal('window', undefined);
  expect((await import('./startupFirestoreTransport')).startupFirestoreTransport).toBe('forced');
  vi.resetModules();
  vi.stubGlobal('window', { get location(): never { throw new Error('unavailable'); } });
  expect((await import('./startupFirestoreTransport')).startupFirestoreTransport).toBe('forced');
});
