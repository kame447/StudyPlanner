import { describe, expect, it } from 'vitest';
import {
  normalizeWeeklyPlanningConstraintAbsenceMetadataV5,
} from './weeklyPlanningConstraintAbsenceNormalizationV5';

describe('constraint absence metadata normalization', () => {
  it('canonicalizes only non-semantic constraint metadata after absence is identified', () => {
    const result = normalizeWeeklyPlanningConstraintAbsenceMetadataV5(JSON.stringify({
      availabilityDeclarations: [{
        localId: 'absence-1',
        kind: 'no_additional_constraint',
        constraintLevel: 'unknown',
        dateExpression: null,
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        recurrenceKind: null,
        days: [],
        sourceText: '今週は特に予定ない',
      }],
    }));

    expect(JSON.parse(result.rawResponse).availabilityDeclarations[0])
      .toEqual(expect.objectContaining({
        kind: 'no_additional_constraint',
        constraintLevel: 'hard',
        sourceText: '今週は特に予定ない',
      }));
    expect(result.repairs).toEqual([
      'document.availabilityDeclarations[0].constraintLevel:absence-metadata-canonicalized',
    ]);
  });

  it('does not reinterpret positive availability', () => {
    const rawResponse = JSON.stringify({
      availabilityDeclarations: [{
        localId: 'availability-1',
        kind: 'available',
        constraintLevel: 'unknown',
      }],
    });

    expect(normalizeWeeklyPlanningConstraintAbsenceMetadataV5(rawResponse))
      .toEqual({ rawResponse, repairs: [] });
  });
});
