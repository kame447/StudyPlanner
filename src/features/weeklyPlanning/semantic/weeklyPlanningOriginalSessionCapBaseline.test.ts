import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from './weeklyPlanningSemanticTypesV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

describe('original accepted content-session cap before margin allocation', () => {
  it.each([{ amount: 20, rate: 3, expected: [30, 30] }, { amount: 40, rate: 2, expected: [30, 30, 30] }])(
    'keeps $amount problems at $rate minutes within the accepted30-minute sessions', ({ amount, rate, expected }) => {
      const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
        graph: createEmptyWeeklyPlanningFactGraphV5(), context: { conversationId: 'session-cap', turnId: 'turn-1', expectedRevision: 0 },
        document: { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan', planningWindow: null,
          tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null, components: [] },
            sourceText: '数学を1回30分で進めたい', workloads: [{ localId: 'work', quantityRole: 'target', amount, unitCode: 'problem', unitLabel: '問',
              rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `${amount}問` }],
            effortEstimates: [{ localId: 'rate', targetLocalId: 'work', kind: 'duration_per_unit', minutes: rate, unitCode: 'problem', precision: 'exact', sourceText: `1問${rate}分` },
              { localId: 'cap', targetLocalId: 'task', kind: 'session_duration', minutes: 30, unitCode: 'session', precision: 'exact', sourceText: '1回30分' }],
            temporalConstraints: [], recurrence: [] }],
          relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
        },
      });
      expect(result.status).toBe('applied');
      expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
      const compiled = compileGenericSchedulerInput({ graph: result.graph, context: { ownerId: 'owner', currentDate: '2026-08-24',
        planningStartDate: '2026-08-24', planningEndDate: '2026-08-30', timeZone: 'UTC' } });
      expect(compiled.status).toBe('ready');
      const input = compiled.input!;
      const preview = scheduleWeeklyPlanningStableV5Preview({ input, graph: createWeeklyPlanningPlacementGraphViewV5(result.graph) });
      expect(preview.status).toBe('ready');
      const capId = result.graph.effortEstimates.find(fact => fact.kind === 'session_duration')!.id;
      const observation = { durations: preview.candidates.map(candidate => candidate.durationMinutes),
        quantities: input.movableWorkItems.map(item => item.quantity.amount),
        capProvenance: input.movableWorkItems.map(item => item.sourceFactRefs.includes(capId)) };
      console.info('session-cap-baseline', JSON.stringify({ amount, rate, ...observation }));
      expect(observation.durations).toEqual(expected);
      expect(observation.quantities.reduce((sum, value) => sum + value, 0)).toBe(amount);
      expect(observation.capProvenance.every(Boolean)).toBe(true);
    },
  );
});
