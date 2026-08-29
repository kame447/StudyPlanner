import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './weeklyPlanningSemanticPromptAssemblyV5';

describe('Stable V5 registered material remaining-scope prompt', () => {
  it('allows an explicit all-remaining choice to become a plan-local remaining workload without replaying bookshelf facts', () => {
    const [system] = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '残り全部で',
      publicStateSummary: {
        registeredMaterials: [{
          name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
          aliases: ['金フレ'],
          progressUnit: 'word',
          remainingUnits: 800,
        }],
      },
    });

    expect(system?.content).toContain('explicitly selects all remaining work');
    expect(system?.content).toContain('saved remainingUnits/unit');
    expect(system?.content).toContain('without copying saved scope_total/completed facts');
  });
});
