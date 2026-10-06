import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { buildHomeDashboardModel } from '../../lib/homeDashboard';
import { TodayScheduleSection } from './HomeSections';

it('offers an accessible plus without the empty explanation and separates viewing from adding', () => {
  const onAddEntry = vi.fn(); const onOpenDay = vi.fn();
  const dashboard = buildHomeDashboardModel({ plans: [], actuals: [], todos: [] });
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<TodayScheduleSection dashboard={dashboard} studyMaterials={[]}
    onAddEntry={onAddEntry} onOpenDay={onOpenDay} />); });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('今日の予定はまだありません');
  const add = renderer.root.findByProps({ 'aria-label': '今日の予定に追加' });
  act(() => add.props.onClick());
  expect(onAddEntry).toHaveBeenCalledOnce(); expect(onOpenDay).not.toHaveBeenCalled();
  const all = renderer.root.findAllByType('button').find(button => button !== add)!;
  act(() => all.props.onClick()); expect(onOpenDay).toHaveBeenCalledWith(dashboard.today);
  act(() => renderer.unmount());
});
