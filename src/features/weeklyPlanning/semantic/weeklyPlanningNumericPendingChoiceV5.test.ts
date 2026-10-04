import { describe, expect, it, vi } from 'vitest';
import { numericFixture, normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { tryNumericPendingChoiceRouteV5 } from './weeklyPlanningNumericPendingChoiceV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
const luna = { createChatCompletion: vi.fn(async () => '') };
describe('D5 typed eligibility and fail-closed selection', () => {
  it.each(['pendingTargetCount', 'measurement', 'perUnit', 'sourceAccess', 'questionPresentation', 'targetStatus', 'formalEligibility', 'intentProvenance'] as const)('rejects unsafe %s before exposure', async field => {
    const h = numericFixture(); const patch: Record<string, unknown> = { pendingTargetCount: 2, measurement: 'session_duration', perUnit: 'page', sourceAccess: 'denied', questionPresentation: 'stale', targetStatus: 'inactive', formalEligibility: 'ineligible', intentProvenance: 'unproven' };
    h.setState({ ...h.state, [field]: patch[field] }); h.port.choose = vi.fn(h.port.choose);
    expect(await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(luna, h.input), h.port)).toBeNull();
    expect(h.port.choose).not.toHaveBeenCalled();
  });
  it('rejects context drift after hashing, before dispatch and after final response', async () => {
    for (const timing of ['dispatch', 'response']) {
      const h = numericFixture(); let exposed = 0;
      h.port.choose = async (r, before) => {
        if (timing === 'dispatch') h.setState({ ...h.state, sourceAccess: 'denied' });
        before(); exposed++;
        if (timing === 'response') h.setState({ ...h.state, binding: { ...h.state.binding, selectionEpoch: 3 } });
        return normalizedChoice(r, 'leaf:2');
      };
      expect(await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(luna, h.input), h.port)).toBeNull();
      expect(exposed).toBe(timing === 'dispatch' ? 0 : 1);
    }
  });
  it('returns no partial document for none, malformed, low probability, mixed or provider failure', async () => {
    for (const failure of ['none', 'mixed', 'malformed', 'low', 'provider']) {
      const h = numericFixture(); h.port.choose = async (r, before) => {
        before(); if (failure === 'provider') throw new Error('fixture');
        const result = normalizedChoice(r, failure === 'none' ? 'none' : 'leaf:2', failure === 'mixed' ? 'extra_or_uncertain_meaning' : 'only_candidate_meaning');
        return failure === 'malformed' ? { ...result, nodeId: 'stale' } : failure === 'low' ? { ...result, probabilities: r.menu.options.map(o => ({ optionId: o.id, probability: o.id === 'leaf:2' ? 0.7 : 0.1 })) } : result;
      };
      expect(await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(luna, h.input), h.port)).toBeNull();
    }
  });
});
