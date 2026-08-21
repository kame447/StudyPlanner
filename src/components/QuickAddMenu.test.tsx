import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { QuickAddMenu } from './QuickAddMenu';

describe('QuickAddMenu', () => {
  it('expands the FAB into staggered actions and routes the selected action', () => {
    const onAddSchedule = vi.fn();
    const onAddStudy = vi.fn();
    const onOpenAiPlanning = vi.fn();
    const renderer = create(
      <QuickAddMenu
        onAddSchedule={onAddSchedule}
        onAddStudy={onAddStudy}
        onOpenAiPlanning={onOpenAiPlanning}
      />,
    );

    const trigger = renderer.root.findByProps({
      className: 'daily-add-fab schedule-add-fab quick-add-trigger print-hide',
    });
    expect(trigger.props['aria-expanded']).toBe(false);

    act(() => {
      trigger.props.onClick();
    });

    expect(renderer.root.findByProps({ className: 'quick-add-menu is-open' })).toBeTruthy();
    const actions = renderer.root.findAllByProps({ role: 'menuitem' });
    const labels = renderer.root
      .findAllByProps({ className: 'quick-add-option-label' })
      .map((label) => label.children.join(''));
    expect(labels).toEqual(['AI計画', '学習を追加', '予定を追加']);
    expect(actions.map((action) => action.props.style['--quick-add-index'])).toEqual([2, 1, 0]);

    act(() => {
      actions[2].props.onClick();
    });

    expect(onAddSchedule).toHaveBeenCalledTimes(1);
    expect(onAddStudy).not.toHaveBeenCalled();
    expect(onOpenAiPlanning).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ className: 'quick-add-menu' })).toBeTruthy();
  });
});
