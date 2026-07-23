import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getWeeklyPlanningRuntimeMode,
  resetWeeklyPlanningRuntimeModeForTest,
} from '../features/weeklyPlanning/application/weeklyPlanningRuntimeMode';
import { WeeklyPlanningConversation } from './WeeklyPlanningConversation';

describe('WeeklyPlanningConversation', () => {
  beforeEach(() => resetWeeklyPlanningRuntimeModeForTest());
  afterEach(() => resetWeeklyPlanningRuntimeModeForTest());

  it('shows a typing indicator without duplicating an input composer', () => {
    const html = renderToStaticMarkup(
      <WeeklyPlanningConversation
        messages={[{
          id: 'user-1',
          role: 'user',
          content: '3時間ぐらいかな',
          createdAt: '2026-07-16T00:00:00.000Z',
        }]}
        isAnalyzing
      />,
    );
    expect(html).toContain('3時間ぐらいかな');
    expect(html).toContain('weekly-planning-typing-indicator');
    expect(html).not.toContain('textarea');
  });

  it('shows the effective runtime and can select Stable V5 before a conversation starts', () => {
    const renderer = create(
      <WeeklyPlanningConversation messages={[]} isAnalyzing={false} />,
    );
    const stableButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === 'Stable V5',
    );
    expect(stableButton).toBeDefined();

    act(() => stableButton?.props.onClick());

    expect(getWeeklyPlanningRuntimeMode()).toBe('stable_v5');
    expect(
      renderer.root.findByProps({ 'aria-label': '週間計画AIの実行方式' }),
    ).toBeDefined();
  });
});
