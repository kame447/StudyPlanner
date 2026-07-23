import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import {
  createEmptyWeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
} from './weeklyPlanningSemanticDocument';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
} from './weeklyPlanningSemanticDocumentV2';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_FACT_GRAPH_GENERATIONS,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS,
  WEEKLY_PLANNING_STABLE_V5_IDENTIFIERS,
} from './weeklyPlanningSemanticSchemaGenerations';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function rootSchema(format: { json_schema: { schema: unknown } }): JsonObject {
  return asObject(format.json_schema.schema, 'json_schema.schema');
}

function rootProperties(root: JsonObject): JsonObject {
  return asObject(root.properties, 'root.properties');
}

function temporalConstraintItems(root: JsonObject): JsonObject {
  const tasks = asObject(rootProperties(root).tasks, 'root.properties.tasks');
  const taskItems = asObject(tasks.items, 'tasks.items');
  const taskProperties = asObject(taskItems.properties, 'tasks.items.properties');
  const constraints = asObject(
    taskProperties.temporalConstraints,
    'tasks.items.properties.temporalConstraints',
  );
  return asObject(constraints.items, 'temporalConstraints.items');
}

function stringArray(value: unknown, path: string): string[] {
  const array = asArray(value, path);
  if (array.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must contain only strings.`);
  }
  return array as string[];
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort();
}

describe('weekly planning semantic schema generations', () => {
  it('locks all current schema generations in the canonical code registry', () => {
    expect(WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS.map((generation) => ({
      version: generation.schemaVersion,
      type: generation.documentTypeName,
      name: generation.jsonSchemaName,
      lifecycle: generation.lifecycle,
      runtimeRole: generation.runtimeRole,
    }))).toEqual([
      {
        version: 'planning-semantic-v0',
        type: 'SemanticPlanningDocument',
        name: 'weekly_planning_semantic_document_v0',
        lifecycle: 'experiment',
        runtimeRole: 'legacy_eval_only',
      },
      {
        version: 'planning-semantic-v1',
        type: 'SemanticPlanningDocumentV1',
        name: 'weekly_planning_semantic_document_v1',
        lifecycle: 'experiment',
        runtimeRole: 'legacy_eval_only',
      },
      {
        version: 'weekly-planning-semantic-v5-alpha1',
        type: 'WeeklyPlanningSemanticDocument',
        name: 'weekly_planning_semantic_document_v5_alpha1',
        lifecycle: 'active_foundation',
        runtimeRole: 'alpha2_foundation',
      },
      {
        version: 'weekly-planning-semantic-v5-alpha2',
        type: 'WeeklyPlanningSemanticDocumentV2',
        name: 'weekly_planning_semantic_document_v5_alpha2',
        lifecycle: 'draft',
        runtimeRole: 'module_pipeline',
      },
      {
        version: 'weekly-planning-semantic-v5',
        type: 'WeeklyPlanningSemanticDocumentV5',
        name: 'weekly_planning_semantic_document_v5',
        lifecycle: 'stable',
        runtimeRole: 'stable_parallel',
      },
    ]);

    const versions = WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS
      .map((generation) => generation.schemaVersion);
    const names = WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS
      .map((generation) => generation.jsonSchemaName);
    expect(new Set(versions).size).toBe(versions.length);
    expect(new Set(names).size).toBe(names.length);
    expect(WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS.every(
      (generation) => !generation.productionConnected && !generation.productionPersisted,
    )).toBe(true);
  });

  it('locks old dependencies while keeping Stable V5 direct and parallel', () => {
    const [v0, v1, alpha1, alpha2, stable] =
      WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS;

    expect(v0.directSchemaDependencies).toEqual([]);
    expect(v0.successorSchemaVersion).toBe(v1.schemaVersion);
    expect(v1.directSchemaDependencies).toEqual([]);
    expect(v1.successorSchemaVersion).toBe(alpha1.schemaVersion);
    expect(alpha1.directSchemaDependencies).toEqual([]);
    expect(alpha1.successorSchemaVersion).toBe(alpha2.schemaVersion);
    expect(alpha2.directSchemaDependencies).toEqual([alpha1.schemaVersion]);
    expect(alpha2.successorSchemaVersion).toBe(stable.schemaVersion);
    expect(stable.directSchemaDependencies).toEqual([]);
    expect(stable.successorSchemaVersion).toBeNull();
    expect(stable.schemaVersion).toBe(WEEKLY_PLANNING_STABLE_V5_IDENTIFIERS.schemaVersion);
    expect(stable.jsonSchemaName).toBe(WEEKLY_PLANNING_STABLE_V5_IDENTIFIERS.jsonSchemaName);
  });

  it('locks Alpha 2 additions and Stable V5 field compatibility', () => {
    const alpha1Root = rootSchema(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT);
    const alpha2Root = rootSchema(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2);
    const stableRoot = rootSchema(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5);
    const alpha1Properties = rootProperties(alpha1Root);
    const alpha2Properties = rootProperties(alpha2Root);
    const stableProperties = rootProperties(stableRoot);
    const alpha1Required = stringArray(alpha1Root.required, 'alpha1.required');
    const alpha2Required = stringArray(alpha2Root.required, 'alpha2.required');
    const stableRequired = stringArray(stableRoot.required, 'stable.required');

    expect(difference(Object.keys(alpha2Properties), Object.keys(alpha1Properties))).toEqual([
      'availabilityDeclarations',
      'constraintSourceRequests',
    ]);
    expect(difference(Object.keys(alpha1Properties), Object.keys(alpha2Properties))).toEqual([]);
    expect(difference(alpha2Required, alpha1Required)).toEqual([
      'availabilityDeclarations',
      'constraintSourceRequests',
    ]);
    expect(difference(alpha1Required, alpha2Required)).toEqual([]);
    expect(difference(Object.keys(stableProperties), Object.keys(alpha2Properties))).toEqual([]);
    expect(difference(Object.keys(alpha2Properties), Object.keys(stableProperties))).toEqual([]);
    expect(difference(stableRequired, alpha2Required)).toEqual([]);
    expect(difference(alpha2Required, stableRequired)).toEqual([]);

    const alpha1Temporal = temporalConstraintItems(alpha1Root);
    const alpha2Temporal = temporalConstraintItems(alpha2Root);
    const stableTemporal = temporalConstraintItems(stableRoot);
    const alpha1TemporalProperties = asObject(
      alpha1Temporal.properties,
      'alpha1.temporal.properties',
    );
    const alpha2TemporalProperties = asObject(
      alpha2Temporal.properties,
      'alpha2.temporal.properties',
    );
    const stableTemporalProperties = asObject(
      stableTemporal.properties,
      'stable.temporal.properties',
    );
    const alpha1TemporalRequired = stringArray(
      alpha1Temporal.required,
      'alpha1.temporal.required',
    );
    const alpha2TemporalRequired = stringArray(
      alpha2Temporal.required,
      'alpha2.temporal.required',
    );
    const stableTemporalRequired = stringArray(
      stableTemporal.required,
      'stable.temporal.required',
    );

    expect(difference(
      Object.keys(alpha2TemporalProperties),
      Object.keys(alpha1TemporalProperties),
    )).toEqual(['constraintLevel', 'namedTimePeriod']);
    expect(difference(alpha2TemporalRequired, alpha1TemporalRequired)).toEqual([
      'constraintLevel',
      'namedTimePeriod',
    ]);
    expect(difference(
      Object.keys(stableTemporalProperties),
      Object.keys(alpha2TemporalProperties),
    )).toEqual([]);
    expect(difference(stableTemporalRequired, alpha2TemporalRequired)).toEqual([]);

    const alpha1Kinds = stringArray(
      asObject(alpha1TemporalProperties.kind, 'alpha1.temporal.kind').enum,
      'alpha1.temporal.kind.enum',
    );
    const alpha2Kinds = stringArray(
      asObject(alpha2TemporalProperties.kind, 'alpha2.temporal.kind').enum,
      'alpha2.temporal.kind.enum',
    );
    const stableKinds = stringArray(
      asObject(stableTemporalProperties.kind, 'stable.temporal.kind').enum,
      'stable.temporal.kind.enum',
    );
    expect(difference(alpha2Kinds, alpha1Kinds)).toEqual([
      'allowed_date',
      'excluded_date',
    ]);
    expect(difference(stableKinds, alpha2Kinds)).toEqual([]);
    expect(difference(alpha2Kinds, stableKinds)).toEqual([]);
  });

  it('locks Fact Graph V1, V2, and direct Stable V5 generations', () => {
    const graphV1 = createEmptyWeeklyPlanningFactGraph();
    const graphV2 = createEmptyWeeklyPlanningFactGraphV2();
    const graphV5 = createEmptyWeeklyPlanningFactGraphV5();
    const [v1, v2, stable] = WEEKLY_PLANNING_FACT_GRAPH_GENERATIONS;

    expect(WEEKLY_PLANNING_FACT_GRAPH_GENERATIONS.map((generation) => ({
      version: generation.factGraphVersion,
      type: generation.graphTypeName,
      lifecycle: generation.lifecycle,
      runtimeRole: generation.runtimeRole,
    }))).toEqual([
      {
        version: 'weekly-planning-fact-graph-v1',
        type: 'WeeklyPlanningFactGraph',
        lifecycle: 'active_foundation',
        runtimeRole: 'v2_foundation',
      },
      {
        version: 'weekly-planning-fact-graph-v2',
        type: 'WeeklyPlanningFactGraphV2',
        lifecycle: 'draft',
        runtimeRole: 'module_pipeline',
      },
      {
        version: 'weekly-planning-fact-graph-v5',
        type: 'WeeklyPlanningFactGraphV5',
        lifecycle: 'stable',
        runtimeRole: 'stable_parallel',
      },
    ]);

    expect(v1.directGraphDependencies).toEqual([]);
    expect(v1.successorFactGraphVersion).toBe(v2.factGraphVersion);
    expect(v2.directGraphDependencies).toEqual([v1.factGraphVersion]);
    expect(v2.successorFactGraphVersion).toBe(stable.factGraphVersion);
    expect(stable.directGraphDependencies).toEqual([]);
    expect(stable.successorFactGraphVersion).toBeNull();
    expect(WEEKLY_PLANNING_FACT_GRAPH_GENERATIONS.every(
      (generation) => !generation.productionConnected && !generation.productionPersisted,
    )).toBe(true);

    expect(graphV1.version).toBe(v1.factGraphVersion);
    expect(graphV2.version).toBe(v2.factGraphVersion);
    expect(graphV5.version).toBe(stable.factGraphVersion);
    expect(graphV5).toMatchObject({
      taskDateRules: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
    });
  });
});
