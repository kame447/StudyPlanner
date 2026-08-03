import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  directWorkCoverageErrorsV5,
  extractDirectWorkExpectationsV5,
  missingDirectWorkExpectationsV5,
} from './weeklyPlanningDirectWorkCoverageV5';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 direct work semantic ownership', () => {
  it.each([
    'レポートを4ページ、演習を12問、片付けを30分進めたいです',
    '申請書を2件；図を3枚；参考書を1冊確認する',
    '演習は12問ではなく8問に変更、レポートを2ページ追加します',
  ])('does not parse user text into deterministic expectations: %s', (userText) => {
    expect(extractDirectWorkExpectationsV5(userText)).toEqual([]);
    expect(missingDirectWorkExpectationsV5({
      userText,
      document: emptyDocument(),
    })).toEqual([]);
    expect(directWorkCoverageErrorsV5({
      userText,
      document: emptyDocument(),
    })).toEqual([]);
  });
});
