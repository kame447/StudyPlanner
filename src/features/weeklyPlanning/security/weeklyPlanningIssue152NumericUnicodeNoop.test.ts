import { describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  createWeeklyPlanningRegisteredMaterialContextV5,
} from '../personalization/weeklyPlanningRegisteredMaterialRuntimeV5';
import {
  deriveWeeklyPlanningSessionPolicyV5,
  DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
} from '../semantic/weeklyPlanningStableV5ExecutionProfile';
import { splitWeeklyPlanningSessionMinutesV5 } from '../semantic/weeklyPlanningStableV5SessionSplitter';
import { validateWeeklyPlanningDecisionTargetReferencesV5 } from '../semantic/weeklyPlanningDecisionReferenceValidationV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';

describe('Issue #152 P1 numeric sibling and splitter boundaries', () => {
  it.fails('surfaces unschedulable work instead of silently returning no chunks above the generation cap', () => {
    // Issue #152 V13 reproduced: a total requiring more than 512 chunks silently becomes an empty schedule input.
    const policy = deriveWeeklyPlanningSessionPolicyV5({
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
      absoluteMaxSessionMinutes: 120,
      minimumSessionMinutes: 30,
    });
    const result = splitWeeklyPlanningSessionMinutesV5({
      totalMinutes: 120 * 513,
      policy,
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it('keeps non-finite registered-material numeric fields out of prompt context', () => {
    const material: StudyMaterial = {
      id: 'material-152',
      userId: 'owner-152',
      name: '教材',
      subjectId: 'subject-152',
      subjectName: '数学',
      aliases: ['数学教材'],
      status: 'active',
      paceEnabled: true,
      progressUnit: 'problem',
      totalUnits: Number.NaN,
      currentUnit: Number.POSITIVE_INFINITY,
      targetDate: undefined,
      estimatedMinutesPerUnit: Number.NaN,
      maxUnitsPerDay: Number.POSITIVE_INFINITY,
      coverImageUrl: undefined,
      coverImageDataUrl: undefined,
      catalogEntryId: 'catalog-152',
      catalogTitle: '教材カタログ名',
      catalogIsbn13: undefined,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    };
    const [context] = createWeeklyPlanningRegisteredMaterialContextV5({
      ownerId: 'owner-152',
      materials: [material],
      userText: '数学教材を進める',
    });
    expect(context).toEqual(expect.objectContaining({
      catalogTitle: '教材カタログ名',
      aliases: ['数学教材'],
      totalUnits: null,
      currentUnit: null,
      estimatedMinutesPerUnit: null,
      maxUnitsPerDay: null,
      remainingUnits: null,
    }));
  });
});

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Issue #152 P1 Unicode/identifier and no-op boundaries', () => {
  it.fails('rejects controls and confusable characters in public decision identifiers', () => {
    // Issue #152 V15 reproduced: an active public identifier is accepted even when it contains controls/confusable characters.
    const document = emptyDocument();
    document.decisions = [{
      localId: 'decision-1',
      target: { kind: 'proposal', publicId: 'proposal-\u0000‮', localId: null, mention: null },
      decision: 'accept',
      sourceText: 'この提案をお願いします',
    }];
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document, {
      learningStrategyProposals: [{ publicId: 'proposal-\u0000‮' }],
    })).not.toEqual([]);
  });

  it('keeps a semantic no-op document free of new user facts and decisions', () => {
    const document = emptyDocument();
    expect(document.userContextFacts).toEqual([]);
    expect(document.decisions).toEqual([]);
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document)).toEqual([]);
  });
});
