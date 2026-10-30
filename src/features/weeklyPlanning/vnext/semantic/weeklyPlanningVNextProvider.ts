import type { WeeklyPlanningVNextInterpretation, WeeklyPlanningVNextInterpretationInput,
  WeeklyPlanningVNextInterpreter } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnError } from '../weeklyPlanningVNextTypes';
import { resolveWeeklyPlanningVNextTurnDelta } from '../application/weeklyPlanningVNextAnswerBinding';
import { applyWeeklyPlanningVNextTurn } from './weeklyPlanningVNextTransaction';
import { buildWeeklyPlanningVNextProviderMessages } from './weeklyPlanningVNextProviderPrompt';
import { decodeVNextProviderOutput, describeVNextProviderField, VNEXT_ESTIMATE_ANSWER_REQUIREMENT,
  VNEXT_PROVIDER_RESPONSE_FORMAT, type VNextProviderReading } from './weeklyPlanningVNextProviderSchema';
import { createVNextProviderReferences } from './weeklyPlanningVNextProviderReferences';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);

function hasContributions(value: unknown): boolean {
  return record(value) && ((value.answer !== null && value.answer !== undefined)
    || (record(value.delta) && Object.values(value.delta).some(items => Array.isArray(items) && items.length > 0)));
}

interface Address { collection: string; index: number; field: string[]; localId: string | null }
function repairAddress(error: VNextTurnError, original: RecordValue): Address | null {
  // Paths describe typed JSON fields, never Japanese source text.
  const path = error.path.replace(/^delta\./, '').replace(/:.*$/, '');
  const match = /^(add|patch|remove|relate|defer)\[(\d+)\](?:\.([A-Za-z][A-Za-z0-9_.]*))?$/.exec(path);
  if (!match || !match[3]) return null; // replacing/removing a whole clause is not formal repair
  const items = record(original.delta) && original.delta[match[1]];
  const item = Array.isArray(items) ? items[Number(match[2])] : null;
  if (!record(item)) return null;
  const localId = typeof item.localId === 'string' ? item.localId : null;
  if (error.localId && error.localId !== localId) return null;
  if (match[1] !== 'add' && match[1] !== 'patch') return null; // these have no stable local IDs
  if (!localId || match[3] === 'localId') return null;
  return { collection: match[1], index: Number(match[2]), field: match[3].split('.'), localId };
}

/** Only addressed fields move from the repair; reordered/replaced unrelated clauses cannot enter. */
function spliceRepair(original: unknown, repaired: unknown, errors: VNextTurnError[]): unknown | null {
  if (!record(original) || !record(repaired) || !record(original.delta) || !record(repaired.delta)) return null;
  const next = structuredClone(original);
  for (const error of errors) {
    const address = repairAddress(error, original);
    if (!address) return null;
    const repairs = repaired.delta[address.collection];
    if (!Array.isArray(repairs)) return null;
    const matches = repairs.filter(item => record(item) && item.localId === address.localId);
    if (matches.length !== 1) return null;
    let from: unknown = matches[0];
    const items = (next.delta as RecordValue)[address.collection] as RecordValue[];
    let to: RecordValue = items[address.index];
    for (const key of address.field.slice(0, -1)) {
      if (!record(from) || !record(from[key]) || !record(to[key])) return null;
      from = from[key]; to = to[key] as RecordValue;
    }
    if (!record(from)) return null;
    const key = address.field[address.field.length - 1];
    // Removing an unknown property is a legal shape repair; null still never means clearing a fact field.
    if (Object.prototype.hasOwnProperty.call(from, key)) Object.defineProperty(to, key,
      { value: structuredClone(from[key]), enumerable: true, writable: true, configurable: true });
    else delete to[key];
  }
  return next;
}

function validateReading(input: WeeklyPlanningVNextInterpretationInput, reading: VNextProviderReading): VNextTurnError[] {
  if (reading.answer) {
    const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
      presented: input.presentedQuestion
        ? { questionKey: input.presentedQuestion.key, graphRevision: input.projection.graphRevision } : null,
      projection: input.projection, graph: input.state.graph, interpreted: reading });
    if (resolved.status === 'conflict') return resolved.errors;
  }
  if (!Object.values(reading.delta).some(items => items.length)) return [];
  const result = applyWeeklyPlanningVNextTurn(input.state, reading.delta, {
    expectedRevision: input.state.graph.revision,
    acceptedDate: input.clock.currentDate,
    turnKey: `native-dry-run:${input.state.graph.revision}`,
    conversationId: 'native-provider-dry-run', turnId: 'native-provider-dry-run', sourceText: input.userText,
  });
  return result.status === 'rejected' ? result.errors : [];
}

export function createWeeklyPlanningVNextProviderInterpreter(): WeeklyPlanningVNextInterpreter {
  return async input => {
    const started = Date.now();
    const metrics = { calls: 0, repairs: 0, latencyMs: 0 };
    const finish = (result: Omit<Extract<WeeklyPlanningVNextInterpretation, { status: 'failed' }>, 'metrics'>
      | Omit<Extract<WeeklyPlanningVNextInterpretation, { status: 'interpreted' }>, 'metrics'>): WeeklyPlanningVNextInterpretation =>
      ({ ...result, metrics: { ...metrics, latencyMs: Math.max(0, Date.now() - started) } });
    const references = createVNextProviderReferences();
    const messages = buildWeeklyPlanningVNextProviderMessages(input, references);
    const decode = (value: unknown) => {
      const shaped = decodeVNextProviderOutput(value);
      return shaped.status === 'decoded' ? references.decodeReading(shaped.reading) : shaped;
    };
    const request = async () => {
      metrics.calls++;
      return input.client.createChatCompletion({ messages, responseFormat: VNEXT_PROVIDER_RESPONSE_FORMAT,
        purpose: 'weekly_planning_semantic_normalizer', maxCompletionTokens: 12_000 });
    };
    let raw: string;
    try { raw = await request(); }
    catch { return finish({ status: 'failed', reason: 'provider_error', errors: [] }); }
    let original: unknown;
    try { original = JSON.parse(raw); }
    catch { return finish({ status: 'failed', reason: 'unparseable', errors: [] }); }
    const decoded = decode(original);
    const errors = decoded.status === 'rejected' ? decoded.errors : validateReading(input, decoded.reading);
    if (!errors.length && decoded.status === 'decoded') return finish({ status: 'interpreted', ...decoded.reading });
    const formal = record(original) && errors.every(error => repairAddress(error, original));
    messages.push({ role: 'assistant', content: raw }, { role: 'user', content: JSON.stringify({
      instruction: formal
        ? 'Formal repair only. Return the full schema document with exactly these addressed fields corrected. Keep every other field unchanged. Match elements by localId, not array position. Do not re-read meaning or add/remove clauses.'
        : `Re-read the original utterance against the supplied state and clock. Keep every clause of the first reading and fix only the reported problems. Return a new full schema document, retaining all independent contributions of that utterance. Use only the same supplied short reference aliases. ${VNEXT_ESTIMATE_ANSWER_REQUIREMENT} This is the single allowed new reading.`,
      errors: errors.map(({ path, localId }) => {
        const requirement = describeVNextProviderField(path, original);
        return { path, localId, ...(requirement ? { requirement } : {}) };
      }),
    }) });
    metrics.repairs++;
    try { raw = await request(); }
    catch { return finish({ status: 'failed', reason: 'provider_error', errors }); }
    let repaired: unknown;
    try { repaired = JSON.parse(raw); }
    catch { return finish({ status: 'failed', reason: 'unparseable', errors }); }
    const spliced = formal ? spliceRepair(original, repaired, errors) : repaired;
    if (!spliced) return finish({ status: 'failed', reason: 'rejected_after_repair', errors });
    const final = decode(spliced);
    if (!formal && final.status === 'decoded' && hasContributions(original) && !hasContributions(final.reading)) {
      return finish({ status: 'failed', reason: 'rejected_after_repair', errors });
    }
    const finalErrors = final.status === 'rejected' ? final.errors : validateReading(input, final.reading);
    return final.status === 'decoded' && !finalErrors.length
      ? finish({ status: 'interpreted', ...final.reading })
      : finish({ status: 'failed', reason: 'rejected_after_repair', errors: finalErrors });
  };
}
