import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WeeklyPlanningPersonalizationProvider } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import {
  createConfirmedDefaultStudyModeFact, createConfirmedWeekStartFact, createEmptyWeeklyPlanningPersonalizationProfile,
  type DefaultStudyMode,
} from '../features/weeklyPlanning/personalization/weeklyPlanningPersonalizationTypes';
import { StudySessionProvider, useStudySessionLauncher } from './StudySessionView';

vi.mock('./home/HomeScene', () => ({ HomeScene: () => null }));

// The saved default study mode is only the start screen's initial selection; one session may still override it.
const STAMP = '2026-11-08T00:00:00.000Z';
let renderer: ReactTestRenderer | undefined;
let launch: NonNullable<ReturnType<typeof useStudySessionLauncher>>;
function Probe() { launch = useStudySessionLauncher()!; return null; }

function profileWith(defaultStudyMode?: DefaultStudyMode) {
  return {
    ...createEmptyWeeklyPlanningPersonalizationProfile(STAMP),
    weekStartsOn: createConfirmedWeekStartFact('monday', STAMP),
    ...(defaultStudyMode ? { defaultStudyMode: createConfirmedDefaultStudyModeFact(defaultStudyMode, STAMP) } : {}),
  };
}
async function open(defaultStudyMode?: DefaultStudyMode) {
  const noop = vi.fn(async () => {});
  await act(async () => {
    renderer = create(
      <WeeklyPlanningPersonalizationProvider profile={profileWith(defaultStudyMode)}
        setWeekStartsOn={async () => true} setDefaultStudyMode={async () => true} resetProfile={async () => true}>
        <StudySessionProvider userId="owner" materials={[]} onSaveActual={noop} onSaveStandaloneActual={noop}><Probe /></StudySessionProvider>
      </WeeklyPlanningPersonalizationProvider>,
    );
  });
  await act(async () => { launch({ kind: 'unplanned' }); });
}
const picker = () => renderer!.root.findByProps({ 'aria-label': '学習方式' });
const selected = () => picker().findAllByType('button').filter(node => node.props['aria-pressed']).map(node => node.props['data-mode']);
// The pomodoro summary line renders "<focus>分 / <break>分".
const lengths = () => {
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') texts.push(node);
    else if (node && typeof node === 'object') [(node as { children?: unknown[] }).children ?? []].flat().forEach(walk);
  };
  walk(renderer!.toJSON());
  return texts.join('');
};

beforeEach(() => {
  vi.stubGlobal('window', { setInterval, clearInterval, confirm: vi.fn(() => true) });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
  vi.stubGlobal('document', { body: { style: { overflow: '' } } });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('starts as the normal timer when no default is saved', async () => {
  await open();
  expect(selected()).toEqual(['normal']);
});

it('starts as the pomodoro with the saved focus and break minutes', async () => {
  await open({ mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 40, customBreakMinutes: 8 } });
  expect(selected()).toEqual(['pomodoro']);
  expect(lengths()).toContain('40分 / 8分');
});

it('starts as the pomodoro with a saved preset length', async () => {
  await open({ mode: 'pomodoro', pomodoro: { preset: '50-10' } });
  expect(selected()).toEqual(['pomodoro']);
  expect(lengths()).toContain('50分 / 10分');
});

it('lets the session override the saved default before it starts', async () => {
  await open({ mode: 'pomodoro', pomodoro: { preset: '25-5' } });
  expect(selected()).toEqual(['pomodoro']);
  await act(async () => { picker().findByProps({ 'data-mode': 'normal', type: 'button' }).props.onClick(); });
  expect(selected()).toEqual(['normal']);
});

it('keeps a saved normal default even when the pomodoro length is saved', async () => {
  await open({ mode: 'normal', pomodoro: { preset: '50-10' } });
  expect(selected()).toEqual(['normal']);
  await act(async () => { picker().findByProps({ 'data-mode': 'pomodoro', type: 'button' }).props.onClick(); });
  expect(selected()).toEqual(['pomodoro']);
  expect(lengths()).toContain('50分 / 10分');
});
