import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_PLANNING_SCHEMA_VERSION,
  WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT,
} from '../semanticV2/weeklyPlanningSemanticExperiment';
import {
  SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
  SEMANTIC_PLANNING_V1_SCHEMA_VERSION,
} from '../semanticV2/weeklyPlanningSemanticExperimentV1';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
} from './weeklyPlanningSemanticDocument';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
} from './weeklyPlanningSemanticDocumentV2';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION,
  createEmptyWeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
  createEmptyWeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
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
  it('locks schema identifiers and JSON Schema names as distinct generations', () => {
    const generations = [
      {
        version: SEMANTIC_PLANNING_SCHEMA_VERSION,
        name: WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT.json_schema.name,
      },
      {
        version: SEMANTIC_PLANNING_V1_SCHEMA_VERSION,
        name: SEMANTIC_PLANNING_V1_RESPONSE_FORMAT.json_schema.name,
      },
      {
        version: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
        name: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT.json_schema.name,
      },
      {
        version: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
        name: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2.json_schema.name,
      },
    ];

    expect(generations).toEqual([
      {
        version: 'planning-semantic-v0',
        name: 'weekly_planning_semantic_document_v0',
      },
      {
        version: 'planning-semantic-v1',
        name: 'weekly_planning_semantic_document_v1',
      },
      {
        version: 'weekly-planning-semantic-v5-alpha1',
        name: 'weekly_planning_semantic_document_v5_alpha1',
      },
      {
        version: 'weekly-planning-semantic-v5-alpha2',
        name: 'weekly_planning_semantic_document_v5_alpha2',
      },
    ]);
    expect(new Set(generations.map((generation) => generation.version)).size)
      .toBe(generations.length);
    expect(new Set(generations.map((generation) => generation.name)).size)
      .toBe(generations.length);
  });

  it('locks Alpha 2 as the additive root and temporal extension of Alpha 1', () => {
    const alpha1Root = rootSchema(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT);
    const alpha2Root = rootSchema(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2);
    const alpha1Properties = rootProperties(alpha1Root);
    const alpha2Properties = rootProperties(alpha2Root);
    const alpha1Required = stringArray(alpha1Root.required, 'alpha1.required');
    const alpha2Required = stringArray(alpha2Root.required, 'alpha2.required');

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

    const alpha1Temporal = temporalConstraintItems(alpha1Root);
    const alpha2Temporal = temporalConstraintItems(alpha2Root);
    const alpha1TemporalProperties = asObject(
      alpha1Temporal.properties,
      'alpha1.temporal.properties',
    );
    const alpha2TemporalProperties = asObject(
      alpha2Temporal.properties,
      'alpha2.temporal.properties',
    );
    const alpha1TemporalRequired = stringArray(
      alpha1Temporal.required,
      'alpha1.temporal.required',
    );
    const alpha2TemporalRequired = stringArray(
      alpha2Temporal.required,
      'alpha2.temporal.required',
    );

    expect(difference(
      Object.keys(alpha2TemporalProperties),
      Object.keys(alpha1TemporalProperties),
    )).toEqual(['constraintLevel', 'namedTimePeriod']);
    expect(difference(alpha2TemporalRequired, alpha1TemporalRequired)).toEqual([
      'constraintLevel',
      'namedTimePeriod',
    ]);

    const alpha1Kinds = stringArray(
      asObject(alpha1TemporalProperties.kind, 'alpha1.temporal.kind').enum,
      'alpha1.temporal.kind.enum',
    );
    const alpha2Kinds = stringArray(
      asObject(alpha2TemporalProperties.kind, 'alpha2.temporal.kind').enum,
      'alpha2.temporal.kind.enum',
    );
    expect(difference(alpha2Kinds, alpha1Kinds)).toEqual([
      'allowed_date',
      'excluded_date',
    ]);
  });

  it('locks Fact Graph V1 and V2 as separate generations', () => {
    const graphV1 = createEmptyWeeklyPlanningFactGraph();
    const graphV2 = createEmptyWeeklyPlanningFactGraphV2();

    expect(WEEKLY_PLANNING_FACT_GRAPH_VERSION).toBe('weekly-planning-fact-graph-v1');
    expect(WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2).toBe('weekly-planning-fact-graph-v2');
    expect(graphV1.version).toBe(WEEKLY_PLANNING_FACT_GRAPH_VERSION);
    expect(graphV2.version).toBe(WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2);
    expect(graphV2).toMatchObject({
      taskDateRules: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
    });
  });
});
