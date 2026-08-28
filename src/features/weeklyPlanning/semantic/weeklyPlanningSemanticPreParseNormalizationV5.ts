import {
  normalizeContainingTaskComponentParentV5,
} from './weeklyPlanningComponentParentNormalizationV5';
import {
  normalizeCopiedUserContextDeltaV5,
} from './weeklyPlanningCopiedUserContextNormalizationV5';
import {
  normalizeWeeklyPlanningConstraintAbsenceMetadataV5,
} from './weeklyPlanningConstraintAbsenceNormalizationV5';
import {
  normalizeExactDuplicateWorkloadPlacementV5,
} from './weeklyPlanningDuplicateWorkloadNormalizationV5';
import {
  normalizeWeeklyPlanningExistingTaskShellV5,
} from './weeklyPlanningExistingTaskShellNormalizationV5';
import {
  normalizePendingQuestionEntityBindingsV5,
} from './weeklyPlanningPendingEntityBindingNormalizationV5';
import {
  normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5,
} from './weeklyPlanningRecurrenceTargetNormalizationV5';
import {
  normalizeResolvedProgressWorkloadsV5,
} from './weeklyPlanningResolvedProgressNormalizationV5';
import {
  normalizeTaskDecompositionUncertaintiesV5,
} from './weeklyPlanningTaskDecompositionNormalizationV5';
import {
  normalizeWeeklyPlanningTemporalClockRawV5,
} from './weeklyPlanningTemporalClockEncodingV5';
import {
  normalizeWeeklyPlanningUserContextPartialDatesV5,
} from './weeklyPlanningUserContextPartialDateNormalizationV5';

export const WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_IDS_V5 = [
  'empty_semantic_delta_envelope',
  'task_decomposition_uncertainty',
  'copied_user_context_delta',
  'user_context_partial_date',
  'existing_task_shell',
  'pending_question_entity_binding',
  'component_parent',
  'duplicate_workload_placement',
  'resolved_progress_workload',
  'recurrence_workload_target',
  'temporal_clock_raw',
  'constraint_absence_metadata',
] as const;

export type WeeklyPlanningSemanticPreParseNormalizationStageIdV5 =
  (typeof WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_IDS_V5)[number];

export type WeeklyPlanningSemanticPreParseNormalizationCategoryV5 =
  | 'semantic_invariant_derivation'
  | 'context_binding_repair'
  | 'representation_repair'
  | 'canonicalization_bridge';

export interface WeeklyPlanningSemanticPreParseNormalizationStageDefinitionV5 {
  category: WeeklyPlanningSemanticPreParseNormalizationCategoryV5;
  owningInvariant: string;
}

export const WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_DEFINITIONS_V5:
Record<
  WeeklyPlanningSemanticPreParseNormalizationStageIdV5,
  WeeklyPlanningSemanticPreParseNormalizationStageDefinitionV5
> = {
  empty_semantic_delta_envelope: {
    category: 'representation_repair',
    owningInvariant: 'an explicitly empty provider delta has one canonical Stable V5 no-change representation',
  },
  task_decomposition_uncertainty: {
    category: 'semantic_invariant_derivation',
    owningInvariant: 'needs_breakdown tasks must expose one work_breakdown uncertainty',
  },
  copied_user_context_delta: {
    category: 'context_binding_repair',
    owningInvariant: 'provider output is a current-turn delta and must not echo stored durable context',
  },
  user_context_partial_date: {
    category: 'canonicalization_bridge',
    owningInvariant: 'a provider-interpreted durable goal-event month or month-part has one equivalent ISO date-range representation',
  },
  existing_task_shell: {
    category: 'context_binding_repair',
    owningInvariant: 'an existing study task delta may omit durable study metadata that is not being changed',
  },
  pending_question_entity_binding: {
    category: 'context_binding_repair',
    owningInvariant: 'an exact pending answer binds to the already identified public target',
  },
  component_parent: {
    category: 'representation_repair',
    owningInvariant: 'nested study components use their unambiguous containing component/task parent',
  },
  duplicate_workload_placement: {
    category: 'representation_repair',
    owningInvariant: 'one semantic workload is represented at one unambiguous structural location',
  },
  resolved_progress_workload: {
    category: 'semantic_invariant_derivation',
    owningInvariant: 'resolved progress must not create a contradictory new target workload',
  },
  recurrence_workload_target: {
    category: 'representation_repair',
    owningInvariant: 'recurrence targets schedulable task/component owners rather than nested workload IDs',
  },
  temporal_clock_raw: {
    category: 'canonicalization_bridge',
    owningInvariant: 'supported clock meaning has one schema-parseable canonical encoding',
  },
  constraint_absence_metadata: {
    category: 'semantic_invariant_derivation',
    owningInvariant: 'absence of a constraint is emitted only from explicit no-additional-constraint meaning',
  },
};

export interface WeeklyPlanningSemanticPreParseNormalizationStageResultV5 {
  id: WeeklyPlanningSemanticPreParseNormalizationStageIdV5;
  category: WeeklyPlanningSemanticPreParseNormalizationCategoryV5;
  owningInvariant: string;
  repairs: string[];
}

export interface WeeklyPlanningSemanticPreParseNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
  stages: WeeklyPlanningSemanticPreParseNormalizationStageResultV5[];
}

interface RawNormalizationResult {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function normalizeEmptySemanticDeltaEnvelopeV5(rawResponse: string): RawNormalizationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || 'schemaVersion' in parsed) {
    return { rawResponse, repairs: [] };
  }

  const topLevelKeys = Object.keys(parsed).sort();
  const expectedKeys = [
    'corrections',
    'execution',
    'facts',
    'grounding',
    'notes',
    'uncertainties',
  ];
  if (
    topLevelKeys.length !== expectedKeys.length
    || topLevelKeys.some((key, index) => key !== expectedKeys[index])
    || !isEmptyArray(parsed.facts)
    || !isEmptyArray(parsed.corrections)
    || !isEmptyArray(parsed.uncertainties)
    || !isEmptyArray(parsed.notes)
    || !isRecord(parsed.execution)
    || Object.keys(parsed.execution).length !== 1
    || !isEmptyArray(parsed.execution.approvalRequests)
    || !isRecord(parsed.grounding)
    || Object.keys(parsed.grounding).sort().join('|') !== 'needsGrounding|note|targetFactIds'
    || parsed.grounding.needsGrounding !== false
    || !isEmptyArray(parsed.grounding.targetFactIds)
    || parsed.grounding.note !== null
  ) {
    return { rawResponse, repairs: [] };
  }

  return {
    rawResponse: JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'discuss',
      planningWindow: null,
      tasks: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    }),
    repairs: ['empty-semantic-delta-envelope-canonicalized'],
  };
}

/**
 * Stable V5 provider-output normalization boundary.
 *
 * Keep the ordered list explicit. A new provider-output rewrite must be added
 * here with an owning invariant and category instead of being inserted ad hoc
 * in response validation. Post-parse canonical representation remains owned by
 * weeklyPlanningSemanticRepresentationCanonicalizationV5.
 */
export function normalizeWeeklyPlanningSemanticPreParseV5(params: {
  rawResponse: string;
  publicStateSummary?: Record<string, unknown>;
}): WeeklyPlanningSemanticPreParseNormalizationResultV5 {
  let rawResponse = params.rawResponse;
  const repairs: string[] = [];
  const stages: WeeklyPlanningSemanticPreParseNormalizationStageResultV5[] = [];

  const applyStage = (
    id: WeeklyPlanningSemanticPreParseNormalizationStageIdV5,
    normalize: (value: string) => RawNormalizationResult,
  ): void => {
    const result = normalize(rawResponse);
    const definition = WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_DEFINITIONS_V5[id];
    rawResponse = result.rawResponse;
    repairs.push(...result.repairs);
    stages.push({
      id,
      category: definition.category,
      owningInvariant: definition.owningInvariant,
      repairs: [...result.repairs],
    });
  };

  applyStage('empty_semantic_delta_envelope', (value) =>
    normalizeEmptySemanticDeltaEnvelopeV5(value));
  applyStage('task_decomposition_uncertainty', (value) =>
    normalizeTaskDecompositionUncertaintiesV5(value));
  applyStage('copied_user_context_delta', (value) =>
    normalizeCopiedUserContextDeltaV5({
      rawResponse: value,
      publicStateSummary: params.publicStateSummary,
    }));
  applyStage('user_context_partial_date', (value) =>
    normalizeWeeklyPlanningUserContextPartialDatesV5(value));
  applyStage('existing_task_shell', (value) =>
    normalizeWeeklyPlanningExistingTaskShellV5({
      rawResponse: value,
      publicStateSummary: params.publicStateSummary,
    }));
  applyStage('pending_question_entity_binding', (value) =>
    normalizePendingQuestionEntityBindingsV5({
      rawResponse: value,
      publicStateSummary: params.publicStateSummary,
    }));
  applyStage('component_parent', (value) =>
    normalizeContainingTaskComponentParentV5(value));
  applyStage('duplicate_workload_placement', (value) =>
    normalizeExactDuplicateWorkloadPlacementV5(value));
  applyStage('resolved_progress_workload', (value) =>
    normalizeResolvedProgressWorkloadsV5(value));
  applyStage('recurrence_workload_target', (value) =>
    normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5(value));
  applyStage('temporal_clock_raw', (value) =>
    normalizeWeeklyPlanningTemporalClockRawV5(value));
  applyStage('constraint_absence_metadata', (value) =>
    normalizeWeeklyPlanningConstraintAbsenceMetadataV5(value));

  return { rawResponse, repairs, stages };
}
