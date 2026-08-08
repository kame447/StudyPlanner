import type {
  ChatMessage,
  JsonSchemaResponseFormat,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_SEMANTIC_NAME_VERIFIER_VERSION_V5 =
  'weekly-planning-semantic-name-verifier-v5' as const;

const NAME_VERIFIER_MAX_COMPLETION_TOKENS = 1200;

type NameCandidateKind = 'task_title' | 'study_context' | 'component_label';
type NameDecisionStatus = 'unchanged' | 'corrected' | 'ambiguous';

interface NameCandidateV5 {
  candidateId: string;
  kind: NameCandidateKind;
  originalValue: string;
  sourceText: string;
}

interface NameDecisionV5 {
  candidateId: string;
  originalValue: string;
  status: NameDecisionStatus;
  canonicalValue: string | null;
}

interface NameVerifierPayloadV5 {
  decisions: NameDecisionV5[];
}

export interface WeeklyPlanningSemanticNameVerificationInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  document: WeeklyPlanningSemanticDocumentV5;
}

export interface WeeklyPlanningSemanticNameVerificationResultV5 {
  status: 'verified' | 'rejected' | 'provider_failure';
  document: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
  providerError: string | null;
  candidateCount: number;
  correctionCount: number;
}

export interface WeeklyPlanningSemanticNameVerifierV5 {
  verify(
    input: WeeklyPlanningSemanticNameVerificationInputV5,
  ): Promise<WeeklyPlanningSemanticNameVerificationResultV5>;
}

const NAME_VERIFIER_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_name_verification_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decisions'],
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'candidateId',
              'originalValue',
              'status',
              'canonicalValue',
            ],
            properties: {
              candidateId: { type: 'string' },
              originalValue: { type: 'string' },
              status: {
                type: 'string',
                enum: ['unchanged', 'corrected', 'ambiguous'],
              },
              canonicalValue: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
              },
            },
          },
        },
      },
    },
  },
};

function candidatesFromDocument(
  document: WeeklyPlanningSemanticDocumentV5,
): NameCandidateV5[] {
  const candidates: NameCandidateV5[] = [];
  for (const task of document.tasks) {
    candidates.push({
      candidateId: `task:${task.localId}:title`,
      kind: 'task_title',
      originalValue: task.title,
      sourceText: task.sourceText,
    });
    if (task.study?.contextLabel) {
      candidates.push({
        candidateId: `task:${task.localId}:contextLabel`,
        kind: 'study_context',
        originalValue: task.study.contextLabel,
        sourceText: task.sourceText,
      });
    }
    for (const component of task.study?.components ?? []) {
      candidates.push({
        candidateId: `component:${component.localId}:label`,
        kind: 'component_label',
        originalValue: component.label,
        sourceText: component.sourceText,
      });
    }
  }
  return candidates;
}

function systemPrompt(): string {
  return [
    'You verify only user-visible entity names in an already interpreted Japanese planning document.',
    'For every supplied candidate, choose exactly one status: unchanged, corrected, or ambiguous.',
    'Use corrected only for obvious spelling, kana/kanji conversion, speech-input, or OCR noise when one ordinary reading is uniquely supported by userText, recentConversation, sourceText, and sibling names.',
    'For corrected, change only the erroneous name portion and preserve the surrounding task meaning, verbs, scope, quantities, dates, and style.',
    'Use unchanged for an already natural name. Do not paraphrase, shorten, expand, translate, beautify, or standardize clean wording.',
    'Use ambiguous when two or more plausible readings could change entity identity or meaning. Never guess in that case.',
    'Return every candidate exactly once, in the same order, with candidateId and originalValue copied exactly.',
    'For unchanged canonicalValue must equal originalValue exactly. For corrected canonicalValue must be the corrected non-empty string and differ from originalValue. For ambiguous canonicalValue must be null.',
    'Return JSON only.',
  ].join('\n');
}

function messagesForInput(
  input: WeeklyPlanningSemanticNameVerificationInputV5,
  candidates: NameCandidateV5[],
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        userText: input.userText,
        recentConversation: input.recentConversation ?? [],
        candidates,
      }),
    },
  ];
}

function parsePayload(raw: string): NameVerifierPayloadV5 | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const decisions = (value as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions)) return null;
  const parsed: NameDecisionV5[] = [];
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null;
    const record = decision as Record<string, unknown>;
    const status = record.status;
    if (
      typeof record.candidateId !== 'string'
      || typeof record.originalValue !== 'string'
      || (status !== 'unchanged' && status !== 'corrected' && status !== 'ambiguous')
      || (record.canonicalValue !== null && typeof record.canonicalValue !== 'string')
    ) {
      return null;
    }
    parsed.push({
      candidateId: record.candidateId,
      originalValue: record.originalValue,
      status,
      canonicalValue: record.canonicalValue as string | null,
    });
  }
  return { decisions: parsed };
}

function validateDecisions(
  candidates: NameCandidateV5[],
  decisions: NameDecisionV5[],
): string[] {
  const errors: string[] = [];
  if (decisions.length !== candidates.length) {
    errors.push(`decision-count-mismatch:${decisions.length}:${candidates.length}`);
    return errors;
  }
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const decision = decisions[index];
    if (decision.candidateId !== candidate.candidateId) {
      errors.push(`candidate-id-mismatch:${index}`);
    }
    if (decision.originalValue !== candidate.originalValue) {
      errors.push(`original-value-mismatch:${candidate.candidateId}`);
    }
    if (decision.status === 'unchanged' && decision.canonicalValue !== candidate.originalValue) {
      errors.push(`unchanged-value-mismatch:${candidate.candidateId}`);
    }
    if (
      decision.status === 'corrected'
      && (
        typeof decision.canonicalValue !== 'string'
        || decision.canonicalValue.trim().length === 0
        || decision.canonicalValue === candidate.originalValue
      )
    ) {
      errors.push(`invalid-corrected-value:${candidate.candidateId}`);
    }
    if (decision.status === 'ambiguous' && decision.canonicalValue !== null) {
      errors.push(`ambiguous-value-must-be-null:${candidate.candidateId}`);
    }
  }
  return errors;
}

function applyDecisions(
  document: WeeklyPlanningSemanticDocumentV5,
  decisions: NameDecisionV5[],
): WeeklyPlanningSemanticDocumentV5 {
  const corrected = new Map(
    decisions
      .filter((decision) => decision.status === 'corrected')
      .map((decision) => [decision.candidateId, decision.canonicalValue as string]),
  );
  return {
    ...document,
    tasks: document.tasks.map((task) => ({
      ...task,
      title: corrected.get(`task:${task.localId}:title`) ?? task.title,
      study: task.study
        ? {
            ...task.study,
            contextLabel: task.study.contextLabel
              ? corrected.get(`task:${task.localId}:contextLabel`) ?? task.study.contextLabel
              : null,
            components: task.study.components.map((component) => ({
              ...component,
              label: corrected.get(`component:${component.localId}:label`) ?? component.label,
            })),
          }
        : null,
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Unknown semantic name verifier provider error.';
}

export function createWeeklyPlanningSemanticNameVerifierV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNameVerifierV5 {
  return {
    async verify(input) {
      const candidates = candidatesFromDocument(input.document);
      if (candidates.length === 0) {
        return {
          status: 'verified',
          document: input.document,
          errors: [],
          providerError: null,
          candidateCount: 0,
          correctionCount: 0,
        };
      }

      let raw: string;
      try {
        raw = await client.createChatCompletion({
          messages: messagesForInput(input, candidates),
          temperature: 0,
          responseFormat: NAME_VERIFIER_RESPONSE_FORMAT_V5,
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: NAME_VERIFIER_MAX_COMPLETION_TOKENS,
        });
      } catch (error) {
        return {
          status: 'provider_failure',
          document: null,
          errors: [],
          providerError: errorMessage(error),
          candidateCount: candidates.length,
          correctionCount: 0,
        };
      }

      const payload = parsePayload(raw);
      if (!payload) {
        return {
          status: 'rejected',
          document: null,
          errors: ['invalid-name-verifier-json'],
          providerError: null,
          candidateCount: candidates.length,
          correctionCount: 0,
        };
      }
      const errors = validateDecisions(candidates, payload.decisions);
      const ambiguous = payload.decisions
        .filter((decision) => decision.status === 'ambiguous')
        .map((decision) => `ambiguous-name:${decision.candidateId}`);
      if (errors.length > 0 || ambiguous.length > 0) {
        return {
          status: 'rejected',
          document: null,
          errors: [...errors, ...ambiguous],
          providerError: null,
          candidateCount: candidates.length,
          correctionCount: 0,
        };
      }

      const correctionCount = payload.decisions.filter(
        (decision) => decision.status === 'corrected',
      ).length;
      return {
        status: 'verified',
        document: applyDecisions(input.document, payload.decisions),
        errors: [],
        providerError: null,
        candidateCount: candidates.length,
        correctionCount,
      };
    },
  };
}
