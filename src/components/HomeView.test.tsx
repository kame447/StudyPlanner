import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StudyMaterial, User } from '../types/domain';
import { HomeView } from './HomeView';

describe('HomeView', () => {
  it('keeps the default dashboard to the fixed four-section layout', () => {
    const html = renderToStaticMarkup(
      <HomeView
        user={{ avatar: '', username: 'test-user', email: 'test@example.com' } as User}
        plans={[]}
        actuals={[]}
        todos={[]}
        studyMaterials={[{ id: 'material-1', status: 'active' } as StudyMaterial]}
        onOpenAiPlanning={vi.fn()}
        onOpenSchedule={vi.fn()}
        onOpenDay={vi.fn()}
        onOpenTodo={vi.fn()}
        onOpenBookshelf={vi.fn()}
        onOpenReport={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const sectionOrder = [
      'next-plan',
      'today-schedule',
      'attention',
      'weekly-progress',
    ];
    let previousIndex = -1;

    for (const sectionId of sectionOrder) {
      const index = html.indexOf(`data-home-section="${sectionId}"`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(html).not.toContain('data-home-section="material-progress"');
  });
});
