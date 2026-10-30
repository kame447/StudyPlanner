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
  it.each([28, 29])('only abbreviates opaque display IDs longer than28 characters (%s)', async length => {
    const displayId = 'a'.repeat(length - 8) + '12345678';
    fetchMock.mockResolvedValueOnce(response({ ok: true, users: [{ ...user(), actorSubjectId: displayId }],
      nextCursor: null, enrichmentReady: true, trend: { daily: [], activeUsers: activeUsers() } }));
    const renderer = await renderPage();
    expect(renderer.root.findAllByType('strong').some(node => node.children.join('') ===
      (length > 28 ? `${displayId.slice(0, 16)}…12345678` : displayId))).toBe(true);
    expect(renderer.root.findAllByType('code').some(node => node.children.join('') === displayId)).toBe(true);
    act(() => renderer.unmount());
  });
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

describe('daily user chart', () => {
  async function renderTrend(daily: Array<{ localDate: string; activeActorCount: number }>) {
    fetchMock.mockResolvedValueOnce(response({
      ok: true, users: [], nextCursor: null, enrichmentReady: true,
      trend: { daily, activeUsers: null },
    }));
    return renderPage();
  }

  it('shows integer count ticks and distinguishes a missing day from zero across months', async () => {
    const renderer = await renderTrend([
      { localDate: '2030-01-30', activeActorCount: 0 },
      { localDate: '2030-02-01', activeActorCount: 7 },
    ]);
    const ticks = renderer.root.findByProps({ className: 'admin-users-trend-count-axis' });
    expect(ticks.findAllByType('span').map((node) => node.children.join('')))
      .toEqual(['0人', '2人', '4人', '6人', '8人']);
    const bars = renderer.root.findByProps({ className: 'admin-users-trend-bars' }).findAllByType('span');
    expect(bars.map((node) => node.props.style.height)).toEqual(['0%', '0%', '87.5%']);
    expect(bars.map((node) => node.props.title)).toEqual(['1/30: 0人', '1/31: データなし', '2/1: 7人']);
    expect(bars[1].props['data-missing']).toBe('true');
    expect(bars[0].props['data-missing']).toBeUndefined();
    const rows = renderer.root.findByType('tbody').findAllByType('tr');
    expect(rows.map((row) => [row.findByType('th').children.join(''), row.findByType('td').children.join('')]))
      .toEqual([['2030-01-30', '0人'], ['2030-01-31', 'データなし'], ['2030-02-01', '7人']]);
    expect(renderer.root.findByType('summary').children.join('')).toBe('日別の人数を表示');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it.each([0, 1, 127])('uses a finite integer axis without painting zero as positive (maximum %i)', async (count) => {
    const renderer = await renderTrend([
      { localDate: '2030-02-01', activeActorCount: 0 },
      { localDate: '2030-02-02', activeActorCount: count },
    ]);
    const ticks = renderer.root.findByProps({ className: 'admin-users-trend-count-axis' })
      .findAllByType('span').map((node) => Number(node.children.join('').replace('人', '')));
    expect(ticks[0]).toBe(0);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(Math.max(1, count));
    expect(ticks.every((tick, index) => Number.isInteger(tick) && (index === 0 || tick > ticks[index - 1]))).toBe(true);
    const bars = renderer.root.findByProps({ className: 'admin-users-trend-bars' }).findAllByType('span');
    expect(bars[0].props.style.height).toBe('0%');
    expect(bars[1].props.style.height).toBe(`${count / ticks[ticks.length - 1] * 100}%`);
    act(() => renderer.unmount());
  });

  it('keeps an empty series empty instead of inventing thirty zero days', async () => {
    const renderer = await renderTrend([]);
    expect(JSON.stringify(renderer.toJSON())).toContain('直近30日の利用データはまだありません。');
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('exposes every exact count in a thirty-day synthetic series', async () => {
    const daily = Array.from({ length: 30 }, (_, index) => ({
      localDate: `2030-04-${String(index + 1).padStart(2, '0')}`,
      activeActorCount: index % 9,
    }));
    const renderer = await renderTrend(daily);
    const rows = renderer.root.findByType('tbody').findAllByType('tr');
    expect(rows).toHaveLength(30);
    expect(rows.map((row) => row.findByType('td').children.join('')))
      .toEqual(daily.map((day) => `${day.activeActorCount}人`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
