import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

function documentWithUncertainty(targetLocalId: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [{
      localId: 'uncertainty-1',
      targetLocalId,
      field: 'target',
      reason: 'referent is ambiguous',
      sourceText: '片方',
    }],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 uncertainty reference validation', () => {
  it('rejects an uncertainty that targets itself', () => {
    const result = validateWeeklyPlanningSemanticResponseV5(
      JSON.stringify(documentWithUncertainty('uncertainty-1')),
      {},
    );

    expect(result.document).toBeNull();
    expect(result.errors).toContain(
      'document.uncertainties[0].targetLocalId:self-reference',
    );
  });

  it('keeps unresolved referents safely targeted at the document', () => {
    const source = documentWithUncertainty('document');
    const result = validateWeeklyPlanningSemanticResponseV5(
      JSON.stringify(source),
      {},
    );

    expect(result.document).toEqual(source);
    expect(result.errors).toEqual([]);
  });
});
