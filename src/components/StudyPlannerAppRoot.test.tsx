import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootManagedAuthenticationProvider } from './RootManagedAuthenticationContext';
import { StudyPlannerAppRoot } from './StudyPlannerAppRoot';

const firebaseState = vi.hoisted(() => ({
  auth: {
    currentUser: null,
  },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_: unknown, listener: (user: null) => void) => {
    listener(null);
    return vi.fn();
  }),
  signOut: vi.fn(async () => undefined),
}));

vi.mock('../App', () => ({
  default: () => null,
}));

vi.mock('../lib/firebaseClient', () => ({
  getFirebaseAuth: () => firebaseState.auth,
}));

vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({
  isWeeklyPlanningTraceFeatureEnabled: () => true,
}));

const originalWindow = globalThis.window;

function installWindow(pathname = '/') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { pathname },
    },
  });
}

describe('StudyPlannerAppRoot', () => {
  beforeEach(() => {
    installWindow();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('hands unauthenticated sign-in state to the root authentication boundary', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(<StudyPlannerAppRoot />);
    });

    expect(
      renderer.root.findAllByType(RootManagedAuthenticationProvider),
    ).toHaveLength(1);

    act(() => renderer.unmount());
  });
});
