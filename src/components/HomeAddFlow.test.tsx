import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeAddFlow } from './HomeAddFlow';
import { MonthEventDialog } from './MonthEventDialog';
import { QuickEntryModal } from './QuickEntryModal';
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('./MonthEventDialog', () => ({ MonthEventDialog: () => <div data-event /> }));
vi.mock('./QuickEntryModal', () => ({ QuickEntryModal: () => <div data-study /> }));
vi.mock('../lib/date', () => ({ todayIsoDate: () => '2026-10-07' }));
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { activeElement: null, body: {} });
  vi.stubGlobal('HTMLElement', class {});
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
const props = () => ({ userId: 'owner', plans: [], actuals: [], materials: [], subjects: [], monthEvents: [],
  onClose: vi.fn(), onSaveTodo: vi.fn(), onSavePlan: vi.fn(), onSaveStandaloneActual: vi.fn(),
  onSaveLinkedActual: vi.fn(), onSaveMonthEvent: vi.fn(), onDeleteMonthEvent: vi.fn() });
for (const kind of ['schedule', 'study'] as const) {
  it(`reuses the ${kind} form with today's date and original persistence callbacks`, () => {
    const callbacks = props();
    act(() => { renderer = create(<HomeAddFlow {...callbacks} />); });
    const actions = renderer!.root.findAllByType('button');
    expect(actions).toHaveLength(3);
    act(() => actions[kind === 'schedule' ? 0 : 1].props.onClick());
    if (kind === 'schedule') {
      const form = renderer!.root.findByType(MonthEventDialog);
      expect(form.props.openDate).toBe('2026-10-07');
      expect(form.props.initialEventId).toBeUndefined();
      expect(form.props.onSave).toBe(callbacks.onSaveMonthEvent);
      expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(0);
    } else {
      const form = renderer!.root.findByType(QuickEntryModal);
      expect(form.props.selectedDate).toBe('2026-10-07');
      expect(form.props.initialMode).toBe('scheduled');
      expect(form.props.onSavePlan).toBe(callbacks.onSavePlan);
      expect(renderer!.root.findAllByType(MonthEventDialog)).toHaveLength(0);
    }
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });
}
