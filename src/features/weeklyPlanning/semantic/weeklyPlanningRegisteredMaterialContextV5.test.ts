import { afterEach, describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  createWeeklyPlanningRegisteredMaterialSummariesV5,
  findRegisteredStudyMaterialForLabelV5,
  getWeeklyPlanningRegisteredMaterialSummariesV5,
  registeredMaterialProgressQuestionV5,
  resetWeeklyPlanningRegisteredMaterialRuntimeForTestV5,
  setWeeklyPlanningRegisteredMaterialRuntimeV5,
} from './weeklyPlanningRegisteredMaterialContextV5';

const OWNER = 'owner-1';

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material-1',
    userId: OWNER,
    name: '基礎問題精講',
    aliases: ['数学 基礎問題精講'],
    subjectId: 'subject-math',
    subjectName: '数学',
    progressUnit: 'page',
    totalUnits: 300,
    currentUnit: 120,
    estimatedMinutesPerUnit: 2,
    status: 'active',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => resetWeeklyPlanningRegisteredMaterialRuntimeForTestV5());

describe('registered material planning context', () => {
  it('keeps only active materials owned by the current user', () => {
    setWeeklyPlanningRegisteredMaterialRuntimeV5({
      ownerId: OWNER,
      materials: [
        material(),
        material({ id: 'other-owner', userId: 'owner-2' }),
        material({ id: 'archived', status: 'archived' }),
      ],
    });

    expect(getWeeklyPlanningRegisteredMaterialSummariesV5(OWNER)).toEqual([
      expect.objectContaining({ publicId: 'material-1', totalUnits: 300, currentUnit: 120 }),
    ]);
  });

  it('matches a unique registered name or alias but rejects ambiguous duplicates', () => {
    const summaries = createWeeklyPlanningRegisteredMaterialSummariesV5([material()]);
    expect(findRegisteredStudyMaterialForLabelV5({
      label: '数学 基礎問題精講',
      materials: summaries,
    })?.publicId).toBe('material-1');

    const ambiguous = createWeeklyPlanningRegisteredMaterialSummariesV5([
      material(),
      material({ id: 'material-2' }),
    ]);
    expect(findRegisteredStudyMaterialForLabelV5({
      label: '基礎問題精講',
      materials: ambiguous,
    })).toBeNull();
  });

  it('does not ask total or current values again when both are registered', () => {
    const question = registeredMaterialProgressQuestionV5({
      label: '基礎問題精講',
      materials: createWeeklyPlanningRegisteredMaterialSummariesV5([material()]),
    });

    expect(question).toContain('全300ページ');
    expect(question).toContain('現在120ページ');
    expect(question).toContain('続きから');
    expect(question).not.toContain('何ページくらい');
  });

  it('uses the registered measurement unit for a concrete question', () => {
    const problems = createWeeklyPlanningRegisteredMaterialSummariesV5([
      material({ progressUnit: 'problem', totalUnits: undefined, currentUnit: undefined }),
    ]);
    expect(registeredMaterialProgressQuestionV5({
      label: '基礎問題精講',
      materials: problems,
    })).toContain('何問くらい');

    const words = createWeeklyPlanningRegisteredMaterialSummariesV5([
      material({ name: 'ターゲット1900', aliases: [], progressUnit: 'word', totalUnits: undefined, currentUnit: undefined }),
    ]);
    expect(registeredMaterialProgressQuestionV5({
      label: 'ターゲット1900',
      materials: words,
    })).toContain('何語くらい');
  });
});
