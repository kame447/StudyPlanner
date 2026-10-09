import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from './HomeView';
import { HomeDisplayClockProvider } from './home/HomeDisplayClockContext';
import { HomeScene } from './home/HomeScene';
import { PIXEL_STUDENT_ENTRY_MS } from './home/useScheduledPixelStudent';
import type { HomeScenePreferences } from '../lib/homeScenePreferences';
import type { Plan } from '../types/domain';

const noop = () => {};
const empty: [] = [];
const ref = { current: null };
function plan(id = 'class', overrides: Partial<Plan> = {}): Plan {
  return { id, seriesId: id, userId: 'student-owner', title: id, subject: 'Math', type: 'study', sourceType: 'timetable',
    date: '2026-10-07', startTime: '10:20', endTime: '11:50', repeat: 'none', repeatUntil: null, excludedDates: [],
    recurrenceRules: [], memo: '', createdAt: '', updatedAt: '', ...overrides };
}
let renderer: ReactTestRenderer | undefined;
let browserWindow: EventTarget;
let browserDocument: EventTarget & { visibilityState: string };
let media: EventTarget & { matches: boolean };
function home(plans = [plan()], preferences: HomeScenePreferences = { style: 'pixel', animated: true }, visible = true) {
  return <StrictMode><HomeDisplayClockProvider>
    {visible ? <HomeView plans={plans} actuals={empty} todos={empty} studyMaterials={empty}
      homeScenePreferences={preferences} primaryHeaderRef={ref} primaryBottomNavRef={ref}
      onOpenAiPlanning={noop} onOpenSchedule={noop} onAddEntry={noop} onOpenDay={noop}
      onOpenTodo={noop} onOpenBookshelf={noop} onOpenReport={noop} /> : null}
  </HomeDisplayClockProvider></StrictMode>;
}
function state() {
  return renderer!.root.findAll(node => typeof node.type === 'string' && node.props['data-pixel-student'])[0]?.props['data-pixel-student'] ?? 'empty';
}
function mount(plans?: Plan[], preferences?: HomeScenePreferences) { act(() => { renderer = create(home(plans, preferences)); }); }
function advance(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); }
function event(target: EventTarget, name: string) { act(() => { target.dispatchEvent(new Event(name)); }); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:19:30'));
  media = Object.assign(new EventTarget(), { matches: false });
  browserWindow = Object.assign(new EventTarget(), { requestAnimationFrame: () => 0, cancelAnimationFrame: noop, matchMedia: () => media });
  browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible', fonts: { ready: Promise.resolve() } });
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', browserDocument);
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('scheduled student in the actual Home card', () => {
  it.each(['timetable', 'manual'] as const)('enters at the local start, then studies for %s plans without changing data', sourceType => {
    const plans = [plan('lesson', { sourceType })];
    const original = JSON.stringify(plans);
    mount(plans);
    expect(state()).toBe('empty');
    advance(29_999); expect(state()).toBe('empty');
    advance(1); expect(state()).toBe('entering');
    expect(renderer!.root.findAllByProps({ className: 'home-pixel-student-walking' })).toHaveLength(1);
    advance(PIXEL_STUDENT_ENTRY_MS); expect(state()).toBe('studying');
    expect(renderer!.root.findAllByProps({ className: 'home-pixel-student-walking' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ className: 'home-pixel-student-writing' })).toHaveLength(1);
    for (const name of ['focus', 'pageshow', 'focus']) event(browserWindow, name);
    expect(state()).toBe('studying');
    expect(JSON.stringify(plans)).toBe(original);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('starts seated when opened during a plan, including exactly its start', () => {
    vi.setSystemTime(new Date('2026-10-07T10:20:00'));
    mount(); expect(state()).toBe('studying');
    advance(30_000);
    act(() => renderer!.update(home([plan()], undefined, false)));
    act(() => renderer!.update(home()));
    expect(state()).toBe('studying');
    act(() => renderer!.unmount()); renderer = undefined;
    mount(); expect(state()).toBe('studying');
  });

  it('does not replay an interrupted entrance after navigation or a hidden-page resume', () => {
    mount(); advance(30_000); expect(state()).toBe('entering');
    act(() => renderer!.update(home([plan()], undefined, false)));
    act(() => renderer!.update(home()));
    expect(state()).toBe('studying');
    browserDocument.visibilityState = 'hidden'; event(browserDocument, 'visibilitychange');
    advance(1_000);
    browserDocument.visibilityState = 'visible'; event(browserDocument, 'visibilitychange');
    expect(state()).toBe('studying');
  });

  it('skips entrance when the start happened while hidden, even resuming right at the boundary', () => {
    mount(); browserDocument.visibilityState = 'hidden'; event(browserDocument, 'visibilitychange');
    advance(30_000);
    browserDocument.visibilityState = 'visible'; event(browserDocument, 'visibilitychange');
    expect(state()).toBe('studying');
  });

  it('goes empty at end, follows the next occurrence, and handles adjacent starts', () => {
    const plans = [plan('first', { endTime: '10:21' }), plan('adjacent', { startTime: '10:21', endTime: '10:22' }),
      plan('later', { startTime: '10:23', endTime: '10:24' })];
    mount(plans); advance(30_000); advance(60_000);
    expect(state()).toBe('entering');
    expect(renderer!.root.findByProps({ className: 'home-plan-title' }).findByType('span').children).toEqual(['adjacent']);
    advance(60_000); expect(state()).toBe('empty');
    advance(60_000); expect(state()).toBe('entering');
    advance(60_000); expect(state()).toBe('empty');
    expect(renderer!.root.findByType('h1').children).toEqual(['次の予定はありません']);
  });

  it('uses the local date through midnight and ignores tomorrow before then', () => {
    vi.setSystemTime(new Date('2026-10-07T23:59:30'));
    const plans = [plan('late', { startTime: '23:00', endTime: '24:00' }),
      plan('morning', { date: '2026-10-08', startTime: '00:01', endTime: '00:02' })];
    mount(plans); expect(state()).toBe('studying');
    advance(30_000); expect(state()).toBe('empty');
    advance(60_000); expect(state()).toBe('entering');
    advance(60_000); expect(state()).toBe('empty');
  });

  it.each(['off', 'reduced'] as const)('shows a static seated student when motion is %s', mode => {
    media.matches = mode === 'reduced';
    mount(undefined, { style: 'pixel', animated: mode !== 'off' });
    expect(state()).toBe('empty'); advance(30_000); expect(state()).toBe('studying');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cancels movement on reduced motion and does not replay when enabled again', () => {
    mount(); advance(30_000); expect(state()).toBe('entering');
    media.matches = true; event(media, 'change'); expect(state()).toBe('studying');
    media.matches = false; event(media, 'change');
    act(() => renderer!.update(home())); expect(state()).toBe('studying');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cancels stale entry on rescheduling or owner replacement', () => {
    mount(); advance(30_000); expect(state()).toBe('entering');
    act(() => renderer!.update(home([plan('replacement', { userId: 'other-owner' })])));
    expect(state()).toBe('studying'); expect(vi.getTimerCount()).toBe(1);
    act(() => renderer!.update(home([plan('replacement', { startTime: '10:25' })])));
    expect(state()).toBe('empty');
  });

  it('never adds a person to other styles or non-study scenes, and keeps preview static', () => {
    for (const style of ['pixel-cat', 'pixel-turtle', 'cozy', 'minimal'] as const) {
      mount(undefined, { style, animated: true }); advance(30_000); expect(state()).toBe('empty');
      act(() => renderer!.unmount()); renderer = undefined;
    }
    mount([plan('errand', { type: 'other', sourceType: 'manual' })]); expect(state()).toBe('empty');
    act(() => renderer!.update(<HomeScene kind="study" preview preferences={{ style: 'pixel', animated: true }} plan={plan()} />));
    expect(state()).toBe('studying');
    expect(renderer!.root.findByProps({ className: 'home-scene-preview' }).props['data-scene-motion']).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
  });
});
