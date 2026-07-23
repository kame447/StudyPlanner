import { describe, expect, it } from 'vitest';
import {
  createConfirmedWeekStartFact,
  createEmptyWeeklyPlanningPersonalizationProfile,
  sanitizeWeeklyPlanningPersonalizationProfile,
} from './weeklyPlanningPersonalizationTypes';

const NOW = '2026-07-18T00:00:00.000Z';

function coefficient(value: number) {
  return {
    value,
    origin: 'plan_actual_summary' as const,
    confidence: 'medium' as const,
    scope: { kind: 'global' as const },
    updatedAt: NOW,
    sourceRef: { kind: 'derived_summary' as const, id: 'summary-1' },
  };
}

describe('weekly planning personalization profile validation', () => {
  it('accepts a versioned profile with explicit provenance', () => {
    const profile = createEmptyWeeklyPlanningPersonalizationProfile(NOW);
    profile.weekStartsOn = createConfirmedWeekStartFact('monday', NOW);

    expect(sanitizeWeeklyPlanningPersonalizationProfile(profile)).toEqual(profile);
  });

  it('migrates version 1 profiles with an empty placement model', () => {
    const sanitized = sanitizeWeeklyPlanningPersonalizationProfile({
      schemaVersion: 1,
      updatedAt: NOW,
      subjectEstimateMultipliers: {},
    });

    expect(sanitized).toMatchObject({
      schemaVersion: 2,
      placementModel: {
        featureVersion: 'placement-features-v1',
        weightVersion: 'placement-weights-v1',
        parameters: {},
      },
    });
  });

  it('retains bounded contextual placement coefficients with provenance', () => {
    const profile = createEmptyWeeklyPlanningPersonalizationProfile(NOW);
    profile.placementModel.parameters['time_band_affinity:evening'] = {
      featureId: 'time_band_affinity',
      contextKey: 'time:evening',
      coefficient: coefficient(0.7),
    };

    expect(sanitizeWeeklyPlanningPersonalizationProfile(profile))
      .toEqual(profile);
  });

  it('drops malformed and unbounded learned values', () => {
    const sanitized = sanitizeWeeklyPlanningPersonalizationProfile({
      schemaVersion: 2,
      updatedAt: NOW,
      weekStartsOn: {
        value: 'friday',
        origin: 'conversation_summary',
        confidence: 'low',
        scope: { kind: 'global' },
        updatedAt: NOW,
        rawText: '金曜からにして',
      },
      subjectEstimateMultipliers: {
        mathematics: {
          value: 10,
          origin: 'plan_actual_summary',
          confidence: 'medium',
          scope: { kind: 'subject', key: 'mathematics' },
          updatedAt: NOW,
        },
      },
      placementModel: {
        featureVersion: 'placement-features-v1',
        weightVersion: 'placement-weights-v1',
        parameters: {
          'bad:coefficient': {
            featureId: 'completion_affinity',
            contextKey: 'global',
            coefficient: coefficient(99),
          },
          'bad:feature': {
            featureId: 'invented_feature',
            contextKey: 'global',
            coefficient: coefficient(0.2),
          },
        },
      },
    });

    expect(sanitized).toMatchObject({
      schemaVersion: 2,
      subjectEstimateMultipliers: {},
      placementModel: { parameters: {} },
    });
    expect(sanitized?.weekStartsOn).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain('rawText');
  });
});
