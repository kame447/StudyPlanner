import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMonthEventDraftFromEvent } from '../domain/planner';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import { doesMonthEventOccurOnDate } from '../lib/monthEvents';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { actual, createLocalFixture, event } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const date = '2026-10-15';
const excludedDate = '2026-10-16';
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  vi.restoreAllMocks(); showNotice.mockClear();
});

async function setup(repeat: 'none' | 'daily') {
  const fixture = createLocalFixture();
  const original = event({ date, endDate: date, repeat, repeatUntil: repeat === 'daily' ? '2026-10-20' : null });
  await fixture.repository.upsertMonthEvent(original);
  await fixture.repository.upsertActual(actual({ planId: original.id, occurrenceDate: date }));
  boundary.repository = fixture.repository;
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const staleVisibleEvent = state.monthEvents[0];
  await act(async () => { await state.saveMonthEvent({
    ...createMonthEventDraftFromEvent(staleVisibleEvent), title: 'Updated event', memo: 'Keep the edited details',
    excludedDates: repeat === 'daily' ? [excludedDate] : [],
  }, original.id); });
  const latest = (await fixture.repository.getMonthEvents('owner'))[0];
  const actuals = await fixture.repository.getActuals('owner');
  return { ...fixture, staleVisibleEvent, latest, actuals };
}

function undoAction() {
  const notice = [...showNotice.mock.calls].reverse().find(call => call[2]?.actionLabel === '元に戻す');
  expect(notice?.[2]?.onAction).toBeTypeOf('function');
  return notice![2]!.onAction!;
}

async function verifyRestored(fixture: Awaited<ReturnType<typeof setup>>) {
  const reloaded = createLocalPlannerRepository(fixture.storage);
  const sources = await reloaded.getScheduleSnapshot('owner');
  expect(sources.monthEvents).toEqual([fixture.latest]);
  expect(state.monthEvents).toEqual([fixture.latest]);
  const actuals = await reloaded.getActuals('owner');
  expect(actuals).toEqual(fixture.actuals);
  for (const includeGeneralEvents of [false, true, false]) {
    const dashboard = buildHomeDashboardModel({ ...sources, actuals, todos: [], now: new Date(date + 'T22:00:00'),
      progressPreferences: { includeGeneralEvents, includeTimetable: false } });
    expect(dashboard.weekActualMinutes).toBe(includeGeneralEvents ? 60 : 0);
  }
  if (fixture.latest.repeat === 'daily') {
    expect(doesMonthEventOccurOnDate(sources.monthEvents[0], excludedDate)).toBe(false);
    expect(doesMonthEventOccurOnDate(sources.monthEvents[0], '2026-10-17')).toBe(true);
  }
}

describe('month-event Undo captures the event admitted for deletion', () => {
  it.each(['none', 'daily'] as const)('restores the latest %s event after deletion receives an older visible object', async repeat => {
    const fixture = await setup(repeat);
    // A retained menu object is older than the accepted edit. Deletion already
    // resolves the latest event by ID; Undo must restore that same event.
    await act(async () => { await state.deleteMonthEvent(fixture.staleVisibleEvent); });
    expect(state.monthEvents).toEqual([]);
    expect(await fixture.repository.getMonthEvents('owner')).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual(fixture.actuals);
    await act(async () => { await undoAction()(); });
    await verifyRestored(fixture);
  });

  it('keeps the captured latest event and linked Actual through a failed Undo and successful retry', async () => {
    const fixture = await setup('daily');
    await act(async () => { await state.deleteMonthEvent(fixture.staleVisibleEvent); });
    const restore = undoAction();
    vi.spyOn(boundary.repository, 'upsertMonthEvent').mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await restore(); });
    expect(showNotice).toHaveBeenLastCalledWith('offline', 'error');
    expect(state.monthEvents).toEqual([]);
    expect(await fixture.repository.getMonthEvents('owner')).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual(fixture.actuals);
    await act(async () => { await restore(); });
    await verifyRestored(fixture);
  });
});
