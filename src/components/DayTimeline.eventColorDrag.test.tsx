import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { TimelineDragVisualState } from '../hooks/useTimelineDragController';
import { buildPlanOccurrenceKey } from '../lib/planRecurrence';
import type { Plan } from '../types/domain';
import { DayTimeline } from './DayTimeline';
import { TimelineDragOverlay } from './TimelineDragOverlay';

const state = vi.hoisted(() => ({ visual: null as TimelineDragVisualState | null }));
vi.mock('../hooks/useTimelineDragController', () => ({
  useTimelineDragController: () => ({
    dragVisual: state.visual, isDragging: () => false, shouldSuppressClick: () => false,
  }),
}));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
const renderers: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => renderers.splice(0).forEach(renderer => renderer.unmount()));
  state.visual = null;
  vi.unstubAllGlobals();
});
function render(node: React.ReactElement) {
  vi.stubGlobal('document', { body: {} });
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(node); });
  renderers.push(renderer);
  return renderer;
}
const plan: Plan = {
  id: 'math', seriesId: 'math', userId: 'owner', date: '2026-10-15', title: '数学の学習', subject: '数学',
  startTime: '09:00', endTime: '10:00', type: 'study', repeat: 'none', repeatUntil: null,
  excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '',
};
function visual(): TimelineDragVisualState {
  return { key: buildPlanOccurrenceKey(plan.id, plan.date), title: plan.title, toneClass: '',
    target: { date: plan.date, startTime: '10:00', endTime: '11:00' }, overlayX: 50, overlayY: 100,
    width: 100, height: 50, tilt: 0 };
}

it('keeps a saved day plan accent while its drag overlay moves', () => {
  state.visual = visual();
  const renderer = render(<DayTimeline dateLabel={plan.date} plans={[plan]} monthEvents={[]} scheduleOccurrences={[]}
    actuals={[]} onSelectEntry={vi.fn()} onPreviousDay={vi.fn()} onNextDay={vi.fn()} onPrint={vi.fn()} />);
  const original = renderer.root.findAllByType('button').find(node => node.props.className.includes('timeline-plan-block'))!;
  const overlay = renderer.root.findByProps({ className: 'schedule-week-drag-overlay' });
  expect(original.props.style['--schedule-event-color']).toBe('#2f78e3');
  expect(overlay.props.style['--schedule-event-color']).toBe(original.props.style['--schedule-event-color']);
  expect(overlay.props.style['--weekly-draft-tone-bg']).toBe('var(--schedule-event-bg)');
});

it('leaves unsaved preview tone classes in control when no saved color is supplied', () => {
  const renderer = render(<TimelineDragOverlay visual={{ ...visual(), toneClass: 'weekly-draft-tone-3' }} placement="preview" />);
  const overlay = renderer.root.findByProps({ className: 'schedule-week-drag-overlay weekly-draft-tone-3' });
  expect(overlay.props.style['--schedule-event-color']).toBeUndefined();
  expect(overlay.props.style.zIndex).toBe(970);
});
