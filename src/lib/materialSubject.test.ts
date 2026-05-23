import { describe, expect, it } from 'vitest';
import { resolveMaterialSubjectName } from './materialSubject';
import type { StudyMaterial, StudySubject } from '../types/domain';

const subject: StudySubject = {
  id: 'subject-toeic',
  userId: 'user-1',
  name: 'TOEIC',
  color: '#2f6fc2',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const material: StudyMaterial = {
  id: 'material-abceed',
  userId: 'user-1',
  name: 'abceed',
  subjectId: subject.id,
  subjectName: '予定',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveMaterialSubjectName', () => {
  it('prefers the current subject name by material subjectId', () => {
    expect(resolveMaterialSubjectName(material, [subject])).toBe('TOEIC');
  });

  it('does not use plan or actual labels as a subject fallback', () => {
    expect(resolveMaterialSubjectName(material, [])).toBe('');
  });
});
