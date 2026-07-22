import {
  SEMANTIC_PLANNING_SCHEMA_VERSION,
  WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT,
} from '../semanticV2/weeklyPlanningSemanticExperiment';
import {
  SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
  SEMANTIC_PLANNING_V1_SCHEMA_VERSION,
} from '../semanticV2/weeklyPlanningSemanticExperimentV1';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION,
} from './weeklyPlanningFactGraph';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
} from './weeklyPlanningFactGraphV2';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
} from './weeklyPlanningSemanticDocument';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
} from './weeklyPlanningSemanticDocumentV2';

export type WeeklyPlanningSemanticSchemaLifecycle =
  | 'experiment'
  | 'active_foundation'
  | 'draft';

export type WeeklyPlanningSemanticSchemaRuntimeRole =
  | 'legacy_eval_only'
  | 'alpha2_foundation'
  | 'module_pipeline';

export interface WeeklyPlanningSemanticSchemaGeneration {
  schemaVersion: string;
  documentTypeName: string;
  jsonSchemaName: string;
  lifecycle: WeeklyPlanningSemanticSchemaLifecycle;
  runtimeRole: WeeklyPlanningSemanticSchemaRuntimeRole;
  directSchemaDependencies: readonly string[];
  successorSchemaVersion: string;
  productionConnected: false;
  productionPersisted: false;
}

export interface WeeklyPlanningFactGraphGeneration {
  factGraphVersion: string;
  graphTypeName: string;
  lifecycle: 'active_foundation' | 'draft';
  runtimeRole: 'v2_foundation' | 'module_pipeline';
  directGraphDependencies: readonly string[];
  successorFactGraphVersion: string;
  productionConnected: false;
  productionPersisted: false;
}

export const WEEKLY_PLANNING_STABLE_V5_NAMING_PROPOSAL = {
  documentTypeName: 'WeeklyPlanningSemanticDocumentV5',
  factGraphTypeName: 'WeeklyPlanningFactGraphV5',
  schemaVersion: 'weekly-planning-semantic-v5',
  jsonSchemaName: 'weekly_planning_semantic_document_v5',
  factGraphVersion: 'weekly-planning-fact-graph-v5',
} as const;

/**
 * Schema generation metadata only. This is not a runtime schema selector.
 * Production code must not dynamically choose a response format from this list.
 */
export const WEEKLY_PLANNING_SEMANTIC_SCHEMA_GENERATIONS = [
  {
    schemaVersion: SEMANTIC_PLANNING_SCHEMA_VERSION,
    documentTypeName: 'SemanticPlanningDocument',
    jsonSchemaName:
      WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT.json_schema.name,
    lifecycle: 'experiment',
    runtimeRole: 'legacy_eval_only',
    directSchemaDependencies: [],
    successorSchemaVersion: SEMANTIC_PLANNING_V1_SCHEMA_VERSION,
    productionConnected: false,
    productionPersisted: false,
  },
  {
    schemaVersion: SEMANTIC_PLANNING_V1_SCHEMA_VERSION,
    documentTypeName: 'SemanticPlanningDocumentV1',
    jsonSchemaName: SEMANTIC_PLANNING_V1_RESPONSE_FORMAT.json_schema.name,
    lifecycle: 'experiment',
    runtimeRole: 'legacy_eval_only',
    directSchemaDependencies: [],
    successorSchemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    productionConnected: false,
    productionPersisted: false,
  },
  {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    documentTypeName: 'WeeklyPlanningSemanticDocument',
    jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT.json_schema.name,
    lifecycle: 'active_foundation',
    runtimeRole: 'alpha2_foundation',
    directSchemaDependencies: [],
    successorSchemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
    productionConnected: false,
    productionPersisted: false,
  },
  {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
    documentTypeName: 'WeeklyPlanningSemanticDocumentV2',
    jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2.json_schema.name,
    lifecycle: 'draft',
    runtimeRole: 'module_pipeline',
    directSchemaDependencies: [WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION],
    successorSchemaVersion: WEEKLY_PLANNING_STABLE_V5_NAMING_PROPOSAL.schemaVersion,
    productionConnected: false,
    productionPersisted: false,
  },
] as const satisfies readonly WeeklyPlanningSemanticSchemaGeneration[];

/**
 * Fact Graph generation metadata only. Persisted graph decoding must use an
 * explicit migration boundary rather than selecting a graph from this list.
 */
export const WEEKLY_PLANNING_FACT_GRAPH_GENERATIONS = [
  {
    factGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION,
    graphTypeName: 'WeeklyPlanningFactGraph',
    lifecycle: 'active_foundation',
    runtimeRole: 'v2_foundation',
    directGraphDependencies: [],
    successorFactGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
    productionConnected: false,
    productionPersisted: false,
  },
  {
    factGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
    graphTypeName: 'WeeklyPlanningFactGraphV2',
    lifecycle: 'draft',
    runtimeRole: 'module_pipeline',
    directGraphDependencies: [WEEKLY_PLANNING_FACT_GRAPH_VERSION],
    successorFactGraphVersion:
      WEEKLY_PLANNING_STABLE_V5_NAMING_PROPOSAL.factGraphVersion,
    productionConnected: false,
    productionPersisted: false,
  },
] as const satisfies readonly WeeklyPlanningFactGraphGeneration[];
