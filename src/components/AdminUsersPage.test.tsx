import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformMocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
  proxyUrl: vi.fn(),
}));

vi.mock('../lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: platformMocks.proxyUrl,
}));

vi.mock('../lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({
    currentUser: { getIdToken: platformMocks.getIdToken },
  }),
}));

import { AdminUsersPage } from './AdminUsersPage';

const fetchMock = vi.fn();

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function user(activeDayCount: number | null | undefined = null) {
  return {
    profileSubjectId: 'profile-opaque',
    actorSubjectId: 'actor-aaaaaaaa',
    registeredAt: '2026-09-01T00:00:00.000Z',
    firstActivityAt: '2026-09-02T00:00:00.000Z',
    lastActivityAt: '2026-09-25T00:00:00.000Z',
    ...(activeDayCount === undefined ? {} : { activeDayCount }),
    eventCount: 3,
    productActivityCount: 1,
    aiRequestCount: 1,
    planningOutcomeCount: 1,
    recentErrorState: 'unknown',
    recentErrorAt: null,
    recentErrorCategory: null,
  };
}

function activeUsers() {
  return {
    schemaVersion: 1,
    environment: 'production',
    asOfDate: '2026-09-25',
    reportingTimeZone: 'Asia/Tokyo',
    today: 1,
    last7Days: 2,
    last30Days: 3,
    updatedAt: '2026-09-25T00:00:00.000Z',
    expireAt: '2027-10-30T00:00:00.000Z',
  };
}

async function renderPage(): Promise<ReturnType<typeof create>> {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<AdminUsersPage navigate={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer!;
}

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { search: '', pathname: '/admin/users' },
    history: { replaceState: vi.fn() },
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  platformMocks.getIdToken.mockReset();
  platformMocks.proxyUrl.mockReset();
  platformMocks.getIdToken.mockResolvedValue('admin-token');
  platformMocks.proxyUrl.mockReturnValue('https://proxy.example/chat/completions');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AdminUsersPage', () => {
  it('renders the integrated trend from the current Worker with one admin request', async () => {
    fetchMock.mockResolvedValueOnce(response({
      ok: true,
      users: [user(null)],
      nextCursor: null,
      enrichmentReady: true,
      trend: { daily: [], activeUsers: activeUsers() },
    }));

    const renderer = await renderPage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/observability/admin/users?');
    const text = JSON.stringify(renderer.toJSON());
    expect(renderer.root.findAll((node) =>
      node.type === 'span' && node.children.join('') === '3人 / 直近30日')).toHaveLength(1);
    expect(text).toContain('利用日数');
    expect(text).toContain('未確認');
    expect(text).not.toContain('null日');
    expect(text).not.toContain('undefined日');
  });

  it.each([
    ['a null daily entry', { daily: [null], activeUsers: null }],
    ['an incomplete active-user window', { daily: [], activeUsers: {} }],
    ['a non-numeric daily count', {
      daily: [{ localDate: '2026-09-25', activeActorCount: '2' }],
      activeUsers: null,
    }],
  ])('shows the existing error state without fallback for %s', async (_label, trend) => {
    fetchMock.mockResolvedValueOnce(response({
      ok: true,
      users: [user(2)],
      nextCursor: null,
      enrichmentReady: true,
      trend,
    }));

    const renderer = await renderPage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/observability/admin/users?');
    const text = JSON.stringify(renderer.toJSON());
    expect(renderer.root.findAll((node) => node.props.role === 'alert')).toHaveLength(1);
    expect(text).toContain('Observability Users response was invalid.');
    expect(text).not.toContain('利用ユーザーの30日推移');
    expect(text).not.toContain('/observability/admin/overview');
  });

  it('falls back to one 30-day Overview for the old Worker response shape', async () => {
    const oldUser = user(undefined);
    delete (oldUser as { recentErrorState?: string }).recentErrorState;
    delete (oldUser as { recentErrorAt?: string | null }).recentErrorAt;
    delete (oldUser as { recentErrorCategory?: string | null }).recentErrorCategory;
    fetchMock
      .mockResolvedValueOnce(response({
        ok: true,
        users: [oldUser],
        nextCursor: null,
      }))
      .mockResolvedValueOnce(response({
        ok: true,
        result: {
          daily: [{ localDate: '2026-09-25', activeActorCount: 2 }],
          activeUsers: activeUsers(),
        },
      }));

    const renderer = await renderPage();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/observability/admin/users?');
    const overviewUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(overviewUrl.pathname).toBe('/observability/admin/overview');
    const fromDate = new Date(`${overviewUrl.searchParams.get('from')}T00:00:00.000Z`);
    const toDate = new Date(`${overviewUrl.searchParams.get('to')}T00:00:00.000Z`);
    expect((toDate.getTime() - fromDate.getTime()) / 86_400_000).toBe(29);
    const text = JSON.stringify(renderer.toJSON());
    expect(renderer.root.findAll((node) =>
      node.type === 'span' && node.children.join('') === '3人 / 直近30日')).toHaveLength(1);
    expect(text).toContain('未確認');
    expect(text).not.toContain('null日');
    expect(text).not.toContain('undefined日');
  });
});
