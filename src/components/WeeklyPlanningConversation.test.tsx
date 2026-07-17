import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeeklyPlanningConversation } from './WeeklyPlanningConversation';

describe('WeeklyPlanningConversation', () => {
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
});
