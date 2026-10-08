import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useTimetableDisplayPreference, type TimetableDisplayView } from './useTimetableDisplayPreference';

it('isolates view keys as well as owners and rejects an old view callback after an ABA switch', () => {
  const values = new Map<string, string>([['study-planner-month-timetable:owner', 'false']]);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key), setItem } });
  let preference!: ReturnType<typeof useTimetableDisplayPreference>;
  function Probe({ view }: { view: TimetableDisplayView }) { preference = useTimetableDisplayPreference(view, 'owner'); return null; }
  let renderer!: ReturnType<typeof create>;
  try {
    act(() => { renderer = create(<Probe view="day" />); });
    expect(preference.showTimetable).toBe(true);
    const old = preference.setShowTimetable;
    act(() => preference.setShowTimetable(false));
    act(() => renderer.update(<Probe view="month" />));
    expect(preference.showTimetable).toBe(false);
    act(() => preference.setShowTimetable(true));
    act(() => renderer.update(<Probe view="day" />));
    expect(preference.showTimetable).toBe(false);
    act(() => old(true));
    expect(preference.showTimetable).toBe(false);
    expect(values.get('study-planner-month-timetable:owner')).toBe('true');
    expect(values.get('study-planner-day-timetable:owner')).toBe('false');
    expect(setItem).toHaveBeenCalledTimes(2);
  } finally { act(() => renderer.unmount()); vi.unstubAllGlobals(); }
});
