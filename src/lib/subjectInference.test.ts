import { describe, expect, it } from 'vitest';
import { inferSubjectFromTitleWithUserCatalog } from './subjectInference';
import type { StudyMaterial, StudySubject } from '../types/domain';

const baseMaterial = {
  userId: 'user-1',
  subjectId: 'subject-1',
  color: '#2f6fc2',
  status: 'active' as const,
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
};

function material(
  overrides: Pick<StudyMaterial, 'id' | 'name' | 'subjectName'> &
    Partial<StudyMaterial>,
): StudyMaterial {
  return {
    ...baseMaterial,
    ...overrides,
  };
}

const subjects: StudySubject[] = [
  {
    id: 'subject-math',
    userId: 'user-1',
    name: 'Math',
    color: '#2f6fc2',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
  },
];

describe('inferSubjectFromTitleWithUserCatalog', () => {
  it('uses user material names before the built-in catalog', () => {
    const result = inferSubjectFromTitleWithUserCatalog('Yellow Chart 30 min', {
      userMaterials: [
        material({
          id: 'material-chart',
          name: 'Yellow Chart',
          subjectName: 'Math',
        }),
      ],
      userSubjects: subjects,
    });

    expect(result).toMatchObject({
      subject: 'Math',
      materialId: 'material-chart',
      materialName: 'Yellow Chart',
      source: 'material',
    });
  });

  it('matches aliases and returns the linked material', () => {
    const result = inferSubjectFromTitleWithUserCatalog('Tango drills', {
      userMaterials: [
        material({
          id: 'material-target',
          name: 'Target 1900',
          subjectName: 'English',
          aliases: ['Target', 'Tango'],
        }),
      ],
    });

    expect(result).toMatchObject({
      subject: 'English',
      materialId: 'material-target',
      materialName: 'Target 1900',
      source: 'material',
    });
  });

  it('prefers the longest specific material match', () => {
    const result = inferSubjectFromTitleWithUserCatalog('Math I Workbook', {
      userMaterials: [
        material({ id: 'material-math', name: 'Math', subjectName: 'Math' }),
        material({ id: 'material-math-1', name: 'Math I', subjectName: 'Math' }),
        material({
          id: 'material-math-workbook',
          name: 'Math I Workbook',
          subjectName: 'Math',
        }),
      ],
    });

    expect(result.materialId).toBe('material-math-workbook');
  });

  it('falls back to user subjects, then built-in catalog, then none', () => {
    expect(
      inferSubjectFromTitleWithUserCatalog('Math review', {
        userSubjects: subjects,
      }),
    ).toMatchObject({
      subject: 'Math',
      source: 'subject',
    });

    expect(inferSubjectFromTitleWithUserCatalog('TOEIC')).toMatchObject({
      subject: expect.any(String),
      source: 'catalog',
    });

    expect(inferSubjectFromTitleWithUserCatalog('walk outside')).toMatchObject({
      subject: null,
      source: 'none',
    });
  });
});
