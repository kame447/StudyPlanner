import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticValueV5,
} from './weeklyPlanningSemanticValidatorV5';

describe('Stable V5 durable learning preference semantics', () => {
  it('accepts an explicitly durable learning preference as user-level context', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      planningIntent: 'discuss',
      planningWindow: null,
      tasks: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [{
        localId: 'learning-preference-1',
        kind: 'learning_preference',
        label: '暗記学習の1回の長さ',
        value: '20分前後を基本にする',
        dateExpression: null,
        sourceText: '暗記系は今後も1回20分くらいを基本にしたいです',
      }],
      uncertainties: [],
      corrections: [],
      decisions: [],
    };

    const result = validateWeeklyPlanningSemanticValueV5(document);
    expect(result.errors).toEqual([]);
    expect(result.document?.userContextFacts).toEqual([
      expect.objectContaining({
        kind: 'learning_preference',
        value: '20分前後を基本にする',
      }),
    ]);
  });
});
