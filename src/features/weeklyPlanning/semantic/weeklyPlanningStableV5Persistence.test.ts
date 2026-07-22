import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningStableV5Envelope,
  decodeWeeklyPlanningStableV5Envelope,
  serializeWeeklyPlanningStableV5Envelope,
} from './weeklyPlanningStableV5Persistence';

function graph() {
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-1',
        category: 'study',
        title: '英単語',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [],
        },
        workloads: [
          {
            localId: 'workload-1',
            quantityRole: 'target',
            amount: 30,
            unitCode: 'minute',
            unitLabel: '分',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '英単語を30分進める',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英単語を30分進める',
      },
    ],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    document,
    context: {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
    },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}

describe('Stable V5 persistence boundary', () => {
  it('round-trips an owner-bound graph with migration metadata', () => {
    const envelope = createWeeklyPlanningStableV5Envelope({
      ownerId: 'owner-1',
      graph: graph(),
      sourceStateVersion: 'weekly-planning-state-v4',
      sourceSchemaVersion: 'weekly-planning-interpreted-command-v4',
      sourceFactGraphVersion: null,
      migratedAt: '2026-07-22T15:00:00.000Z',
    });
    const serialized = serializeWeeklyPlanningStableV5Envelope(envelope);
    const decoded = decodeWeeklyPlanningStableV5Envelope(serialized, 'owner-1');

    expect(decoded.errors).toEqual([]);
    expect(decoded.envelope).toEqual(envelope);
    expect(decoded.envelope).toMatchObject({
      envelopeVersion: 'weekly-planning-fact-graph-envelope-v5',
      ownerId: 'owner-1',
      graph: { version: 'weekly-planning-fact-graph-v5', revision: 1 },
      migration: {
        sourceStateVersion: 'weekly-planning-state-v4',
        sourceSchemaVersion: 'weekly-planning-interpreted-command-v4',
        sourceFactGraphVersion: null,
        migrationVersion: 'weekly-planning-stable-v5-migration-v1',
        migratedAt: '2026-07-22T15:00:00.000Z',
      },
    });
    expect(serializeWeeklyPlanningStableV5Envelope(decoded.envelope!)).toBe(serialized);
  });

  it('rejects an owner mismatch without returning the graph', () => {
    const envelope = createWeeklyPlanningStableV5Envelope({
      ownerId: 'owner-1',
      graph: graph(),
      sourceStateVersion: 'weekly-planning-state-v4',
      migratedAt: '2026-07-22T15:00:00.000Z',
    });
    const decoded = decodeWeeklyPlanningStableV5Envelope(
      JSON.stringify(envelope),
      'owner-2',
    );

    expect(decoded.envelope).toBeNull();
    expect(decoded.errors.map((error) => error.code)).toContain('owner-mismatch');
  });

  it('rejects unknown envelope versions instead of rewriting them', () => {
    const envelope = createWeeklyPlanningStableV5Envelope({
      ownerId: 'owner-1',
      graph: graph(),
      sourceStateVersion: 'weekly-planning-state-v4',
      migratedAt: '2026-07-22T15:00:00.000Z',
    });
    const unknown = {
      ...envelope,
      envelopeVersion: 'weekly-planning-fact-graph-envelope-v6',
    };
    const decoded = decodeWeeklyPlanningStableV5Envelope(
      JSON.stringify(unknown),
      'owner-1',
    );

    expect(decoded.envelope).toBeNull();
    expect(decoded.errors.map((error) => error.code)).toContain(
      'unknown-envelope-version',
    );
  });

  it('rejects broken graph references atomically', () => {
    const envelope = createWeeklyPlanningStableV5Envelope({
      ownerId: 'owner-1',
      graph: graph(),
      sourceStateVersion: 'weekly-planning-state-v4',
      migratedAt: '2026-07-22T15:00:00.000Z',
    });
    const broken = structuredClone(envelope);
    broken.graph.workloads[0].taskId = 'missing-task';
    const decoded = decodeWeeklyPlanningStableV5Envelope(
      JSON.stringify(broken),
      'owner-1',
    );

    expect(decoded.envelope).toBeNull();
    expect(decoded.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid-graph',
        details: expect.arrayContaining(['graph.workloads[0].taskId']),
      }),
    ]));
  });

  it('rejects malformed migration metadata and invalid JSON', () => {
    const envelope = createWeeklyPlanningStableV5Envelope({
      ownerId: 'owner-1',
      graph: graph(),
      sourceStateVersion: 'weekly-planning-state-v4',
      migratedAt: '2026-07-22T15:00:00.000Z',
    });
    const malformed = {
      ...envelope,
      migration: {
        ...envelope.migration,
        migratedAt: '2026-07-22',
      },
    };

    expect(
      decodeWeeklyPlanningStableV5Envelope(JSON.stringify(malformed), 'owner-1')
        .errors.map((error) => error.code),
    ).toContain('invalid-migration-metadata');
    expect(decodeWeeklyPlanningStableV5Envelope('{', 'owner-1')).toEqual({
      envelope: null,
      errors: [{ code: 'invalid-json' }],
    });
  });
});
