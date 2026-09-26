import {
  FOCUSED_AUTHORIZATION_JUDGE_PROMPT,
  GEMINI_JUDGE_PROMPT_VERSION,
  GEMINI_JUDGE_SCHEMA_VERSION,
  GEMINI_JUDGMENT_RESPONSE_SCHEMA,
  parseGeminiJudgment,
  type GeminiJudgeRecord,
} from './geminiJudgeContract';
import {
  HUMAN_REVIEW_RUBRIC_TEXT,
  HUMAN_REVIEW_RUBRIC_VERSION,
  validateReviewInputs,
  type FocusedAuthorizationReviewInput,
} from './humanReviewSheet';

export const GEMINI_AGENT_JUDGE_PACKET_VERSION = 'gemini-agent-judge-packet-v1' as const;

export interface GeminiAgentJudgePacketItem {
  itemId: string;
  lastAssistantMessage: string | null;
  currentUserText: string;
}

export interface GeminiAgentJudgePacket {
  packetVersion: typeof GEMINI_AGENT_JUDGE_PACKET_VERSION;
  packetId: string;
  promptVersion: typeof GEMINI_JUDGE_PROMPT_VERSION;
  schemaVersion: typeof GEMINI_JUDGE_SCHEMA_VERSION;
  instructions: string;
  rubricVersion: typeof HUMAN_REVIEW_RUBRIC_VERSION;
  rubric: string;
  responseFormat: Record<string, unknown>;
  items: GeminiAgentJudgePacketItem[];
}

export interface GeminiAgentJudgeMappingItem {
  itemId: string;
  caseId: string;
}

export interface GeminiAgentJudgeMapping {
  packetId: string;
  packetSha256: string;
  runIndex: number;
  items: GeminiAgentJudgeMappingItem[];
}

export interface GeminiAgentJudgeMeta {
  name: string;
  launchModel: string;
  effort: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function seededOrder<T>(values: readonly T[], seed: string, runIndex: number): T[] {
  const result = [...values];
  const random = seededRandom(fnv1a32(`${seed}:run-${runIndex}`));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  if (result.length < 2) return result;
  const rotation = (runIndex - 1) % result.length;
  return [...result.slice(rotation), ...result.slice(0, rotation)];
}

export function serializeGeminiAgentJudgePacket(packet: GeminiAgentJudgePacket): string {
  return `${JSON.stringify(packet, null, 2)}\n`;
}

export function serializeGeminiAgentJudgeMapping(mapping: GeminiAgentJudgeMapping): string {
  return `${JSON.stringify(mapping, null, 2)}\n`;
}

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function responseFormat(packetId: string, itemIds: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['packetId', 'judgments'],
    properties: {
      packetId: { type: 'string', const: packetId },
      agentReportedModel: { type: 'string', minLength: 1 },
      judgments: {
        type: 'array',
        minItems: itemIds.length,
        maxItems: itemIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId', ...GEMINI_JUDGMENT_RESPONSE_SCHEMA.required],
          properties: {
            itemId: { type: 'string', enum: itemIds },
            ...GEMINI_JUDGMENT_RESPONSE_SCHEMA.properties,
          },
        },
      },
    },
  };
}

export async function buildGeminiAgentJudgePacket(
  inputs: readonly FocusedAuthorizationReviewInput[],
  options: { runIndex: number; seed: string | number },
): Promise<{ packet: GeminiAgentJudgePacket; mapping: GeminiAgentJudgeMapping }> {
  validateReviewInputs(inputs);
  if (!Number.isSafeInteger(options.runIndex) || options.runIndex < 1) {
    throw new Error('Gemini agent judge runIndex must be a positive integer.');
  }
  if ((typeof options.seed !== 'string' && typeof options.seed !== 'number')
    || String(options.seed).length === 0) {
    throw new Error('Gemini agent judge seed must be a non-empty string or number.');
  }
  const seed = String(options.seed);
  const ordered = seededOrder(inputs, seed, options.runIndex);
  const identity = await sha256Text(JSON.stringify({
    packetVersion: GEMINI_AGENT_JUDGE_PACKET_VERSION,
    runIndex: options.runIndex,
    seed,
    items: ordered.map((input) => [input.lastAssistantMessage, input.currentUserText]),
  }));
  const packetId = `gajp-${identity.slice(0, 24)}`;
  const width = Math.max(3, String(ordered.length).length);
  const packetItems = ordered.map((input, index): GeminiAgentJudgePacketItem => ({
    itemId: `item-${identity.slice(0, 8)}-${String(index + 1).padStart(width, '0')}`,
    lastAssistantMessage: input.lastAssistantMessage,
    currentUserText: input.currentUserText,
  }));
  const packet: GeminiAgentJudgePacket = {
    packetVersion: GEMINI_AGENT_JUDGE_PACKET_VERSION,
    packetId,
    promptVersion: GEMINI_JUDGE_PROMPT_VERSION,
    schemaVersion: GEMINI_JUDGE_SCHEMA_VERSION,
    instructions: FOCUSED_AUTHORIZATION_JUDGE_PROMPT,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    rubric: HUMAN_REVIEW_RUBRIC_TEXT,
    responseFormat: responseFormat(packetId, packetItems.map((item) => item.itemId)),
    items: packetItems,
  };
  const packetSha256 = await sha256Text(serializeGeminiAgentJudgePacket(packet));
  return {
    packet,
    mapping: {
      packetId,
      packetSha256,
      runIndex: options.runIndex,
      items: ordered.map((input, index) => ({
        itemId: packetItems[index].itemId,
        caseId: input.id,
      })),
    },
  };
}

function parseMapping(value: unknown): GeminiAgentJudgeMapping {
  const root = object(value);
  if (!root || !hasExactKeys(root, ['packetId', 'packetSha256', 'runIndex', 'items'])) {
    throw new Error('Gemini agent judge mapping does not match the expected shape.');
  }
  if (!nonEmptyString(root.packetId)
    || typeof root.packetSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(root.packetSha256)
    || !Number.isSafeInteger(root.runIndex)
    || (root.runIndex as number) < 1
    || !Array.isArray(root.items)) {
    throw new Error('Gemini agent judge mapping metadata is invalid.');
  }
  const itemIds = new Set<string>();
  const caseIds = new Set<string>();
  const items = root.items.map((value, index): GeminiAgentJudgeMappingItem => {
    const item = object(value);
    if (!item || !hasExactKeys(item, ['itemId', 'caseId'])
      || !nonEmptyString(item.itemId) || !nonEmptyString(item.caseId)) {
      throw new Error(`Gemini agent judge mapping item ${index + 1} is invalid.`);
    }
    if (itemIds.has(item.itemId)) throw new Error(`Duplicate mapping itemId: ${item.itemId}`);
    if (caseIds.has(item.caseId)) throw new Error(`Duplicate mapping caseId: ${item.caseId}`);
    itemIds.add(item.itemId);
    caseIds.add(item.caseId);
    return { itemId: item.itemId, caseId: item.caseId };
  });
  return {
    packetId: root.packetId,
    packetSha256: root.packetSha256,
    runIndex: root.runIndex as number,
    items,
  };
}

function parseAgentMeta(value: unknown): GeminiAgentJudgeMeta {
  const root = object(value);
  if (!root || !hasExactKeys(root, ['name', 'launchModel', 'effort'])
    || !nonEmptyString(root.name)
    || !nonEmptyString(root.launchModel)
    || !nonEmptyString(root.effort)) {
    throw new Error('Gemini agent metadata must contain non-empty name, launchModel, and effort.');
  }
  return { name: root.name, launchModel: root.launchModel, effort: root.effort };
}

export function importGeminiAgentJudgments(
  mappingValue: unknown,
  responseText: string,
  agentMetaValue: unknown,
): GeminiJudgeRecord[] {
  const mapping = parseMapping(mappingValue);
  const agentMeta = parseAgentMeta(agentMetaValue);
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error('Gemini agent judgment response is not valid JSON.');
  }
  const root = object(parsed);
  if (!root || !hasExactKeys(root, ['packetId', 'judgments'], ['agentReportedModel'])) {
    throw new Error('Gemini agent judgment response does not match the expected wrapper.');
  }
  if (root.packetId !== mapping.packetId) {
    throw new Error(`Gemini agent judgment packetId mismatch: expected ${mapping.packetId}.`);
  }
  if (!Array.isArray(root.judgments)) {
    throw new Error('Gemini agent judgment response judgments must be an array.');
  }
  if (root.agentReportedModel !== undefined && !nonEmptyString(root.agentReportedModel)) {
    throw new Error('Gemini agent judgment agentReportedModel must be a non-empty string when present.');
  }
  const expectedItemIds = new Set(mapping.items.map((item) => item.itemId));
  const byItemId = new Map<string, ReturnType<typeof parseGeminiJudgment>>();
  root.judgments.forEach((value, index) => {
    const entry = object(value);
    if (!entry || !nonEmptyString(entry.itemId)) {
      throw new Error(`Gemini agent judgment entry ${index + 1} has no valid itemId.`);
    }
    if (!expectedItemIds.has(entry.itemId)) {
      throw new Error(`Unknown Gemini agent judgment itemId: ${entry.itemId}`);
    }
    if (byItemId.has(entry.itemId)) {
      throw new Error(`Duplicate Gemini agent judgment itemId: ${entry.itemId}`);
    }
    const judgmentValue = { ...entry };
    delete judgmentValue.itemId;
    byItemId.set(entry.itemId, parseGeminiJudgment(judgmentValue));
  });
  const reportedModel = root.agentReportedModel as string | undefined;
  return mapping.items.map((item): GeminiJudgeRecord => {
    const present = byItemId.has(item.itemId);
    const judgment = byItemId.get(item.itemId) ?? null;
    const status = !present ? 'missing' : judgment ? 'judged' : 'invalid_response';
    return {
      caseId: item.caseId,
      judgeStatus: 'gemini_judged_candidate',
      judgeProvider: 'gemini',
      judgeTransport: 'orrery_agent',
      agent: {
        name: agentMeta.name,
        program: 'antigravity',
        launchModel: agentMeta.launchModel,
        effort: agentMeta.effort,
        reportedModel: reportedModel ?? null,
      },
      packetId: mapping.packetId,
      packetSha256: mapping.packetSha256,
      promptVersion: GEMINI_JUDGE_PROMPT_VERSION,
      schemaVersion: GEMINI_JUDGE_SCHEMA_VERSION,
      runIndex: mapping.runIndex,
      status,
      reason: status === 'judged' ? null : status,
      judgment,
    };
  });
}
