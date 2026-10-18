import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { buildMonthPanelProjection } from '../lib/monthViewProjection';
import { event } from '../repositories/localPersistenceConcurrency.testUtils';
import { DayTimeline } from './DayTimeline';
import { MonthDaySheet } from './MonthDaySheet';
import { WeekView } from './WeekView';

const renderers: ReactTestRenderer[] = [];
afterEach(() => act(() => renderers.splice(0).forEach(renderer => renderer.unmount())));
function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  renderers.push(renderer);
  return renderer;
}
function expectPinkCard(renderer: ReactTestRenderer) {
  expect(renderer.root.findAll(node => typeof node.type === 'string'
    && node.props.style?.['--schedule-event-color'] === '#ef7b9f').length).toBeGreaterThan(0);
}
const source = event({ color: 'pink' });
const projection = (monthEvent = source) => createScheduleOccurrenceProjection({ ownerId: 'owner', plans: [], monthEvents: [monthEvent], startDate: source.date, endDate: source.date }).occurrences;

describe('selected event color across calendar surfaces', () => {
  it.each([false, true])('colors Day cards with occurrence projection=%s', useProjection => {
    expectPinkCard(render(<DayTimeline dateLabel={source.date} plans={[]} monthEvents={[source]}
      scheduleOccurrences={useProjection ? projection() : []} actuals={[]}
      onSelectEntry={vi.fn()} onPreviousDay={vi.fn()} onNextDay={vi.fn()} onPrint={vi.fn()} />));
  });
  it.each([false, true])('colors Week cards with spanning=%s', spanning => {
    expectPinkCard(render(<WeekView selectedDate={source.date} plans={[]} actuals={[]}
      monthEvents={[{ ...source, ...(spanning ? { startTime: '00:00', endTime: '24:00' } : {}) }]} onOpenDay={vi.fn()} />));
  });
  it.each([undefined, 'owner'])('colors Month day sheet with owner=%s', userId => {
    expectPinkCard(render(<MonthDaySheet openDate={source.date} userId={userId} monthEvents={[source]}
      onCreate={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />));
  });
  it('provides the selected accent to Month grid and spanning bars', () => {
    const month = buildMonthPanelProjection({ monthDate: source.date, userId: 'owner', plans: [], actuals: [], monthEvents: [source] });
    expect([...month.eventColors.values()]).toEqual(['#ef7b9f']);
  });
});
