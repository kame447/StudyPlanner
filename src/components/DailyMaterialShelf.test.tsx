import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StudyMaterial } from '../types/domain';
import { DailyMaterialShelf } from './DailyMaterialShelf';

const materials: StudyMaterial[] = [
  {
    id: 'material-z',
    userId: 'user-1',
    name: 'Z教材',
    subjectId: 'missing-subject',
    subjectName: '元の科目名',
    color: '#111111',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'material-a',
    userId: 'user-1',
    name: 'A教材',
    subjectId: 'missing-subject',
    subjectName: '別の古い科目名',
    color: '#222222',
    status: 'active',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
];

describe('DailyMaterialShelf', () => {
  it('keeps fallback subject metadata from the first source material while sorting cards', () => {
    const html = renderToStaticMarkup(
      <DailyMaterialShelf
        userId="user-1"
        subjects={[]}
        materials={materials}
        onOpenBookshelf={vi.fn()}
        onOpenAddMaterial={vi.fn()}
        onSelectMaterial={vi.fn()}
      />,
    );

    expect(html).toContain('>元の科目名</h3>');
    expect(html).not.toContain('>別の古い科目名</h3>');
    expect(html.indexOf('A教材')).toBeLessThan(html.indexOf('Z教材'));
  });
});
