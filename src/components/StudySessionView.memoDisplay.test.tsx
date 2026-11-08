import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Plan } from '../types/domain';
import { StudySessionProvider, useStudySessionLauncher } from './StudySessionView';

vi.mock('./home/HomeScene', () => ({ HomeScene: () => null }));

const MARKERS = 'Stable V5 preview / graphRevision: 2 / workItemKey: wpwi_x / [weekly-source:block-1] / [weekly-approval:op-1]';
const plan = (memo: string): Plan => ({ id: 'plan-1', seriesId: 'plan-1', userId: 'owner', title: '数学', subject: '数学', date: '2026-11-03',
  startTime: '18:00', endTime: '19:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo,
  sourceType: 'weekly-planning', sourceId: 'v1:op-1:block-1', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' });
let renderer: ReactTestRenderer | undefined;
let launch: NonNullable<ReturnType<typeof useStudySessionLauncher>>;
function Probe() { launch = useStudySessionLauncher()!; return null; }
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    setInterval: () => 1, clearInterval: () => {}, confirm: () => true,
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
  });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
  vi.stubGlobal('document', { body: { style: { overflow: '' } } });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

async function memoRows(memo: string): Promise<string[]> {
  await act(async () => {
    renderer = create(<StudySessionProvider userId="owner" materials={[]} onSaveActual={vi.fn(async () => {})} onSaveStandaloneActual={vi.fn(async () => {})}><Probe /></StudySessionProvider>);
  });
  await act(async () => { launch({ kind: 'planned', plan: plan(memo) }); });
  const root = renderer!.root;
  return root.findAllByType('dt').filter(node => node.children.includes('メモ')).map(node => {
    const value = node.parent!.findAllByType('dd')[0];
    return value.children.join('');
  });
}

it('shows the user\'s memo in the session details, without the weekly planning bookkeeping', async () => {
  expect(await memoRows(`図書館で / ${MARKERS}`)).toEqual(['図書館で']);
});

it('shows no memo row when the memo is only bookkeeping', async () => {
  expect(await memoRows(MARKERS)).toEqual([]);
});
