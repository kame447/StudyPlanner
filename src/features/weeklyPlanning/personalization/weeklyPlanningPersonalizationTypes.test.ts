import { describe, expect, it } from 'vitest';
import {
  createConfirmedWeekStartFact,
  createEmptyWeeklyPlanningPersonalizationProfile,
  sanitizeWeeklyPlanningPersonalizationProfile,
} from './weeklyPlanningPersonalizationTypes';

describe('weekly planning personalization profile validation', () => {
  it('accepts a versioned profile with explicit provenance', () => {
    const profile = createEmptyWeeklyPlanningPersonalizationProfile('2026-07-18T00:00:00.000Z');
    profile.weekStartsOn = createConfirmedWeekStartFact(
      'monday',
      '2026-07-18T00:00:00.000Z',
    );

    expect(sanitizeWeeklyPlanningPersonalizationProfile(profile)).toEqual(profile);
  });

  it('drops malformed and unbounded learned values', () => {
    const sanitized = sanitizeWeeklyPlanningPersonalizationProfile({
      schemaVersion: 1,
      updatedAt: '2026-07-18T00:00:00.000Z',
      weekStartsOn: {
        value: 'friday',
        origin: 'conversation_summary',
        confidence: 'low',
        scope: { kind: 'global' },
        updatedAt: '2026-07-18T00:00:00.000Z',
        rawText: '金曜からにして',
      },
      subjectEstimateMultipliers: {
        mathematics: {
          value: 10,
          origin: 'plan_actual_summary',
          confidence: 'medium',
          scope: { kind: 'subject', key: 'mathematics' },
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
      },
    });

    expect(sanitized).toMatchObject({
      schemaVersion: 1,
      subjectEstimateMultipliers: {},
    });
    expect(sanitized?.weekStartsOn).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain('rawText');
  });
});
