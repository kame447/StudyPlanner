import { create } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { buildHomeDashboardModel } from '../../lib/homeDashboard';
import { WeeklyProgressSection } from './WeeklyProgressSection';

it('keeps the complete percentage accessible while giving its unit a compact size', () => {
  const dashboard = { ...buildHomeDashboardModel({ plans: [], actuals: [], todos: [] }), weekProgressPercent: 100 };
  const renderer = create(<WeeklyProgressSection dashboard={dashboard} onOpenReport={() => {}} />);
  const ring = renderer.root.findByProps({ className: 'weekly-progress-ring' });
  expect(ring.props['aria-label']).toBe('週全体の予定に対する達成率 100%');
  expect(ring.findByType('strong').children[0]).toBe('100');
  expect(ring.findByType('small').children).toEqual(['%']);
  renderer.unmount();
});
