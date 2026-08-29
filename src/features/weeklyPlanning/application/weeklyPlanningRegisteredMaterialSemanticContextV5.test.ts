import { afterEach, describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  clearWeeklyPlanningRegisteredMaterialRuntimeV5,
  setWeeklyPlanningRegisteredMaterialRuntimeV5,
} from '../personalization/weeklyPlanningRegisteredMaterialRuntimeV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createStableV5SemanticPublicStateSummary } from './weeklyPlanningStableV5SemanticContext';

const OWNER_ID = 'owner-material-semantic-context';

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'gold-phrase',
    userId: OWNER_ID,
    name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    subjectId: 'english',
    subjectName: '英語',
    aliases: ['金フレ'],
    status: 'active',
    paceEnabled: true,
    progressUnit: 'word',
    totalUnits: 1000,
    currentUnit: 200,
    targetDate: '2026-09-07',
    catalogEntryId: 'seed:gold-phrase',
    catalogTitle: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  clearWeeklyPlanningRegisteredMaterialRuntimeV5(OWNER_ID);
});

describe('Stable V5 registered material semantic context', () => {
  it('publishes the mentioned bookshelf material as structured known context', () => {
    setWeeklyPlanningRegisteredMaterialRuntimeV5({
      ownerId: OWNER_ID,
      materials: [
        material({
          id: 'other-material',
          name: '別の教材',
          aliases: [],
          updatedAt: '2026-08-30T00:00:00.000Z',
        }),
        material(),
      ],
    });

    const summary = createStableV5SemanticPublicStateSummary({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      messages: [],
      ownerId: OWNER_ID,
      currentDate: '2026-08-29',
      userText: '明日から金フレを9月7日まで進めたい',
    });

    expect(summary.registeredMaterials).toEqual([
      expect.objectContaining({
        materialId: 'gold-phrase',
        aliases: ['金フレ'],
        progressUnit: 'word',
        totalUnits: 1000,
        currentUnit: 200,
        remainingUnits: 800,
        targetDate: '2026-09-07',
      }),
      expect.objectContaining({ materialId: 'other-material' }),
    ]);
  });

  it('does not publish another user material roster', () => {
    setWeeklyPlanningRegisteredMaterialRuntimeV5({
      ownerId: OWNER_ID,
      materials: [material()],
    });

    const summary = createStableV5SemanticPublicStateSummary({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      messages: [],
      ownerId: 'different-owner',
      currentDate: '2026-08-29',
      userText: '金フレを進めたい',
    });

    expect(summary.registeredMaterials).toEqual([]);
  });
});
