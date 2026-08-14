import { describe, expect, it } from 'vitest';
import {
  buildSubjectsWithMaterialFallback,
  getActiveStudyMaterials,
  groupMaterialsBySubjectId,
} from './bookshelfMaterials';
import type { StudyMaterial, StudySubject } from '../types/domain';

const subjects: StudySubject[] = [
  {
    id: 'subject-math',
    userId: 'user-1',
    name: '数学',
    color: '#111111',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const materials: StudyMaterial[] = [
  {
    id: 'material-b',
    userId: 'user-1',
    name: 'B問題集',
    subjectId: 'subject-math',
    subjectName: '数学',
    status: 'active',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'material-a',
    userId: 'user-1',
    name: 'A問題集',
    subjectId: 'subject-math',
    subjectName: '数学',
    status: 'active',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  },
  {
    id: 'material-legacy',
    userId: 'user-1',
    name: '旧教材',
    subjectId: 'subject-legacy',
    subjectName: '物理',
    color: '#222222',
    status: 'active',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  },
  {
    id: 'material-archived',
    userId: 'user-1',
    name: 'アーカイブ',
    subjectId: 'subject-math',
    subjectName: '数学',
    status: 'archived',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  },
  {
    id: 'material-other-user',
    userId: 'user-2',
    name: '他ユーザー',
    subjectId: 'subject-math',
    subjectName: '数学',
    status: 'active',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  },
];

describe('bookshelfMaterials', () => {
  it('selects only active materials owned by the current user', () => {
    expect(getActiveStudyMaterials(materials, 'user-1').map((material) => material.id)).toEqual([
      'material-b',
      'material-a',
      'material-legacy',
    ]);
  });

  it('restores a fallback subject for material data whose subject record is missing', () => {
    const active = getActiveStudyMaterials(materials, 'user-1');
    const result = buildSubjectsWithMaterialFallback({
      subjects,
      activeMaterials: active,
      userId: 'user-1',
      fallbackColor: '#999999',
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: 'subject-legacy',
      userId: 'user-1',
      name: '物理',
      color: '#222222',
    });
  });

  it('groups materials by subject and sorts each group by Japanese name', () => {
    const grouped = groupMaterialsBySubjectId(
      getActiveStudyMaterials(materials, 'user-1'),
    );

    expect(grouped.get('subject-math')?.map((material) => material.name)).toEqual([
      'A問題集',
      'B問題集',
    ]);
    expect(grouped.get('subject-legacy')?.map((material) => material.id)).toEqual([
      'material-legacy',
    ]);
  });
});
