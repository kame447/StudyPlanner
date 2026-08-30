import { describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  createWeeklyPlanningRegisteredMaterialContextV5,
  WEEKLY_PLANNING_REGISTERED_MATERIAL_CONTEXT_LIMIT_V5,
} from './weeklyPlanningRegisteredMaterialRuntimeV5';

const OWNER_ID = 'owner-material-context';

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material-1',
    userId: OWNER_ID,
    name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    subjectId: 'subject-english',
    subjectName: '英語',
    aliases: ['金フレ', '金のフレーズ'],
    status: 'active',
    paceEnabled: true,
    progressUnit: 'word',
    totalUnits: 1000,
    currentUnit: 200,
    targetDate: '2026-09-07',
    estimatedMinutesPerUnit: 0.6,
    maxUnitsPerDay: 120,
    coverImageUrl: 'https://example.com/cover.jpg',
    coverImageDataUrl: 'data:image/png;base64,secret-cover',
    catalogEntryId: 'seed:toeic-gold-phrase',
    catalogTitle: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    catalogIsbn13: '9784023315686',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('weekly planning registered material context V5', () => {
  it('prioritizes an alias mentioned in the current turn and exposes only planning-relevant facts', () => {
    const [matched, other] = createWeeklyPlanningRegisteredMaterialContextV5({
      materials: [
        material({
          id: 'material-other',
          name: '別の英単語帳',
          aliases: [],
          updatedAt: '2026-08-29T00:00:00.000Z',
        }),
        material(),
      ],
      userText: '明日から9月7日まで金フレを進めたい',
    });

    expect(matched).toEqual(expect.objectContaining({
      materialId: 'material-1',
      catalogEntryId: 'seed:toeic-gold-phrase',
      aliases: ['金フレ', '金のフレーズ'],
      progressUnit: 'word',
      totalUnits: 1000,
      currentUnit: 200,
      remainingUnits: 800,
      targetDate: '2026-09-07',
    }));
    expect(other?.materialId).toBe('material-other');
    expect(matched).not.toHaveProperty('coverImageUrl');
    expect(matched).not.toHaveProperty('coverImageDataUrl');
    expect(matched).not.toHaveProperty('userId');
  });

  it('excludes archived materials and caps the prompt-facing roster', () => {
    const activeMaterials = Array.from(
      { length: WEEKLY_PLANNING_REGISTERED_MATERIAL_CONTEXT_LIMIT_V5 + 5 },
      (_, index) => material({
        id: `material-${index}`,
        name: `教材 ${index}`,
        aliases: [],
        updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const contexts = createWeeklyPlanningRegisteredMaterialContextV5({
      materials: [
        ...activeMaterials,
        material({ id: 'archived', name: '使っていない教材', status: 'archived' }),
      ],
    });

    expect(contexts).toHaveLength(WEEKLY_PLANNING_REGISTERED_MATERIAL_CONTEXT_LIMIT_V5);
    expect(contexts.some((entry) => entry.materialId === 'archived')).toBe(false);
  });

  it('uses only the current explicit material snapshot and never retains a previous one', () => {
    const first = createWeeklyPlanningRegisteredMaterialContextV5({ materials: [material()] });
    expect(first[0]?.materialId).toBe('material-1');

    const second = createWeeklyPlanningRegisteredMaterialContextV5({ materials: [] });
    expect(second).toEqual([]);
  });
});
