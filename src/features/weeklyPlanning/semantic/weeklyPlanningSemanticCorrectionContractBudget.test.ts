import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5,
} from './weeklyPlanningSemanticPublicStateV5';

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe('Stable V5 correction targeting context budget', () => {
  it('keeps the always-sent correction contract compact', () => {
    expect(bytes(WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5)).toBeLessThanOrEqual(500);
  });
});
