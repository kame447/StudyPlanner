import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ScheduleToolbar } from './ScheduleToolbar';

it('keeps month/year labels and date selection without the redundant boundary caption', () => {
  for (const [selectedDate, label, nextDate] of [
    ['2026-05-31', '6月', '2026-06-01'],
    ['2026-12-31', '2027年 1月', '2027-01-01'],
  ]) {
    const onChangeDay = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<ScheduleToolbar viewMode="day" selectedDate={selectedDate}
      monthDate={`${selectedDate.slice(0, 7)}-01`} onChangeView={vi.fn()} onChangeMonth={vi.fn()}
      onChangeWeek={vi.fn()} onChangeDay={onChangeDay} />); });
    try {
      const boundaries = renderer.root.findAllByProps({ className: 'schedule-day-month-boundary' });
      expect(boundaries.map(node => node.findByType('strong').children.join(''))).toContain(label);
      expect(JSON.stringify(renderer.toJSON())).not.toContain('ここから');
      const next = renderer.root.findAllByType('button').find(node =>
        node.props['aria-label']?.startsWith(`${nextDate.slice(0, 4)}年 ${Number(nextDate.slice(5, 7))}月1日`));
      expect(next).toBeDefined();
      act(() => next!.props.onClick());
      expect(onChangeDay).toHaveBeenCalledWith(nextDate);
    } finally { act(() => renderer.unmount()); }
  }
});
