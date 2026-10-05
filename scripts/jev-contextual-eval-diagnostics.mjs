// @ts-check
// Imported only by the evaluation harness. These records share the existing
// restricted eval artifact access/retention boundary, never production telemetry.
export const ERROR_BODY_BYTE_CAP = 4_096;
export const ERROR_BODY_TIMEOUT_MS = 200;
export const REQUEST_ID_LENGTH_CAP = 128;
export const REQUEST_ID_HEADERS = Object.freeze({ luna: 'x-request-id', jev: 'x-generation-id' });

const ERROR_TYPES = /** @type {const} */ (['invalid_request_error', 'authentication_error', 'permission_error',
  'rate_limit_error', 'api_error', 'server_error', 'unknown']);
const ERROR_CODES = /** @type {const} */ (['invalid_prompt', 'invalid_value', 'invalid_api_key', 'insufficient_quota',
  'model_not_found', 'context_length_exceeded', 'rate_limit_exceeded', 'content_policy_violation',
  'unsupported_parameter', 'invalid_json_schema', 'invalid_request_error', 'server_error',
  'bad_request', 'unauthorized', 'payment_required', 'forbidden', 'request_timeout',
  'rate_limited', 'internal_server_error', 'bad_gateway', 'service_unavailable', 'unknown']);
const ERROR_PARAMS = /** @type {const} */ (['model', 'messages', 'messages_role', 'messages_content',
  'response_format', 'json_schema', 'json_schema_name', 'json_schema_schema', 'json_schema_strict',
  'max_completion_tokens', 'service_tier', 'state', 'questions', 'unknown']);
const PARAM_PATHS = Object.freeze({ model: 'model', messages: 'messages',
  'messages[0].role': 'messages_role', 'messages[1].role': 'messages_role', 'messages[2].role': 'messages_role',
  'messages[0].content': 'messages_content', 'messages[1].content': 'messages_content', 'messages[2].content': 'messages_content',
  response_format: 'response_format', 'response_format.json_schema': 'json_schema',
  'response_format.json_schema.name': 'json_schema_name', 'response_format.json_schema.schema': 'json_schema_schema',
  'response_format.json_schema.strict': 'json_schema_strict', max_completion_tokens: 'max_completion_tokens',
  service_tier: 'service_tier', state: 'state', questions: 'questions' });
const HTTP_ERROR_CODES = Object.freeze({ 400: 'bad_request', 401: 'unauthorized', 402: 'payment_required',
  403: 'forbidden', 408: 'request_timeout', 429: 'rate_limited', 500: 'internal_server_error',
  502: 'bad_gateway', 503: 'service_unavailable' });
const BODY_STATUSES = /** @type {const} */ (['complete', 'malformed_json', 'byte_cap', 'timeout', 'read_failure']);
const JEV_CHOICES = /** @type {const} */ (['target', 'remaining', 'completed', 'focused_luna', 'fallback']);
const GATE_STATUSES = /** @type {const} */ (['accepted', 'deferred', 'abstained', 'unavailable', 'unknown']);
const GATE_REASONS = /** @type {const} */ (['none', 'luna_owned', 'cross_question_choice', 'uncertain',
  'conflicting_heads', 'configuration', 'timeout', 'cancelled', 'network', 'http', 'invalid_response', 'model_mismatch', 'unknown']);
const GATE_VERSIONS = /** @type {const} */ (['contextual-conservative-v2-calibrated', 'unknown']);

/** @typedef {'luna' | 'jev'} Provider */
/** @typedef {{type: (typeof ERROR_TYPES)[number], code: (typeof ERROR_CODES)[number], param: (typeof ERROR_PARAMS)[number], bodyStatus: (typeof BODY_STATUSES)[number]}} ProviderError */
/** @typedef {{status: (typeof GATE_STATUSES)[number], reason: (typeof GATE_REASONS)[number], decision: 'target' | 'remaining' | 'completed' | 'fallback' | null, gateVersion: (typeof GATE_VERSIONS)[number]}} RecomputedGate */
/** @typedef {{choice: (typeof JEV_CHOICES)[number] | null, confidence: number | null, selectedProbability: number | null, conditionChange: number | null, independentMeaning: number | null, gateRecomputedByHarness: RecomputedGate}} JevDiagnostic */
/** @typedef {{elapsedToHeadersMs: number | null, requestId: string | null, providerError: ProviderError | null, jev: JevDiagnostic | 'notApplicable' | null}} EvalDispatchDiagnostics */

/** @param {unknown} value @returns {Record<string, unknown> | null} */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? /** @type {Record<string, unknown>} */ (value) : null;
/** @template {string} T @param {unknown} value @param {readonly T[]} allowed @param {T} fallback @returns {T} */
const allowedValue = (value, allowed, fallback) => typeof value === 'string' && allowed.includes(/** @type {T} */ (value))
  ? /** @type {T} */ (value) : fallback;
/** @param {unknown} value @returns {value is number} */
const probability = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
/** @param {unknown} value */
const nullableProbability = (value) => value === null || probability(value);
/** @param {unknown} value @param {readonly string[]} allowed */
const includesValue = (value, allowed) => typeof value === 'string' && allowed.includes(value);
/** @param {unknown} value @returns {value is string} */
export const isOpaqueRequestId = (value) => typeof value === 'string' && value.length > 0
  && value.length <= REQUEST_ID_LENGTH_CAP && /^[A-Za-z0-9_-]+$/.test(value);
/** @param {Headers} headers @param {Provider} provider */
export function providerRequestId(headers, provider) {
  const value = headers.get(REQUEST_ID_HEADERS[provider]);
  return isOpaqueRequestId(value) ? value : null;
}
/** @param {Provider} provider @returns {EvalDispatchDiagnostics} */
export const emptyDispatchDiagnostics = (provider) => ({ elapsedToHeadersMs: null, requestId: null, providerError: null,
  jev: provider === 'luna' ? 'notApplicable' : null });
/** @param {(typeof BODY_STATUSES)[number]} bodyStatus @returns {ProviderError} */
const unknownError = (bodyStatus) => ({ type: 'unknown', code: 'unknown', param: 'unknown', bodyStatus });

/** @param {unknown} payload @returns {ProviderError} */
export function typedProviderError(payload) {
  const error = record(record(payload)?.error);
  const code = error?.code;
  const param = error?.param;
  return {
    type: allowedValue(error?.type, ERROR_TYPES, 'unknown'),
    code: typeof code === 'number' && Object.hasOwn(HTTP_ERROR_CODES, code)
      ? /** @type {(typeof ERROR_CODES)[number]} */ (HTTP_ERROR_CODES[/** @type {keyof typeof HTTP_ERROR_CODES} */ (code)])
      : allowedValue(code, ERROR_CODES, 'unknown'),
    param: typeof param === 'string' && Object.hasOwn(PARAM_PATHS, param)
      ? /** @type {(typeof ERROR_PARAMS)[number]} */ (PARAM_PATHS[/** @type {keyof typeof PARAM_PATHS} */ (param)]) : 'unknown',
    bodyStatus: 'complete',
  };
}

// A timeout races the whole read, including stalled reads and cancellation.
// Cancellation of a cloned response's tee may wait on the original branch;
// never await it or abort the original provider request for diagnostics.
/** @param {Response} response @returns {Promise<ProviderError>} */
export async function readProviderError(response) {
  if (!response.body) return unknownError('malformed_json');
  let reader;
  try { reader = response.body.getReader(); } catch { return unknownError('read_failure'); }
  const bytes = new Uint8Array(ERROR_BODY_BYTE_CAP);
  let used = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const cancel = () => { try { void reader.cancel().catch(() => undefined); } catch { /* local diagnostic only */ } };
  const read = async () => {
    try {
      while (used < ERROR_BODY_BYTE_CAP) {
        const next = await reader.read();
        if (next.done) {
          try { return typedProviderError(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)))); }
          catch { return unknownError('malformed_json'); }
        }
        const count = Math.min(next.value.byteLength, ERROR_BODY_BYTE_CAP - used);
        bytes.set(next.value.subarray(0, count), used);
        used += count;
      }
      return unknownError('byte_cap');
    } catch { return unknownError('read_failure'); }
  };
  try {
    return await Promise.race([read(), new Promise(/** @param {(value: ProviderError) => void} resolve */ resolve => {
      timer = setTimeout(() => { cancel(); resolve(unknownError('timeout')); }, ERROR_BODY_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
    cancel();
    // A pending read settles when cancel resolves; the reader is local only.
    bytes.fill(0);
  }
}

/** @param {unknown} evaluation @param {unknown} gate @param {unknown} gateVersion @returns {JevDiagnostic} */
export function typedJevDiagnostic(evaluation, gate, gateVersion) {
  const result = record(evaluation);
  const decision = record(gate);
  const choice = result?.status === 'evaluated' && includesValue(result.decision, JEV_CHOICES)
    ? /** @type {(typeof JEV_CHOICES)[number]} */ (result.decision) : null;
  const value = /** @param {unknown} number */ (number) => probability(number) ? number : null;
  return { choice, confidence: choice === null ? null : value(result?.confidence),
    selectedProbability: choice === null ? null : value(record(result?.probabilities)?.[choice]),
    conditionChange: choice === null ? null : value(result?.conditionChange),
    independentMeaning: choice === null ? null : value(result?.independentMeaning),
    gateRecomputedByHarness: {
      status: allowedValue(decision?.status, GATE_STATUSES, 'unknown'),
      reason: decision?.status === 'accepted' ? 'none' : allowedValue(decision?.reason, GATE_REASONS, 'unknown'),
      decision: decision?.status === 'accepted' && includesValue(decision.decision, ['target', 'remaining', 'completed', 'fallback'])
        ? /** @type {RecomputedGate['decision']} */ (decision.decision) : null,
      gateVersion: allowedValue(gateVersion, GATE_VERSIONS, 'unknown'),
    } };
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/** @param {unknown} value @param {Provider} provider */
export function isEvalDispatchDiagnostics(value, provider) {
  const diagnostic = record(value);
  if (!diagnostic || !exactKeys(diagnostic, ['elapsedToHeadersMs', 'requestId', 'providerError', 'jev'])) return false;
  const elapsed = diagnostic.elapsedToHeadersMs;
  if (!(elapsed === null || typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0)
    || !(diagnostic.requestId === null || isOpaqueRequestId(diagnostic.requestId))) return false;
  if (diagnostic.providerError !== null) {
    const error = record(diagnostic.providerError);
    if (!error || !exactKeys(error, ['type', 'code', 'param', 'bodyStatus'])
      || !includesValue(error.type, ERROR_TYPES) || !includesValue(error.code, ERROR_CODES)
      || !includesValue(error.param, ERROR_PARAMS) || !includesValue(error.bodyStatus, BODY_STATUSES)) return false;
  }
  if (diagnostic.jev === 'notApplicable') return provider === 'luna';
  if (diagnostic.jev !== null) {
    const jev = record(diagnostic.jev);
    if (provider !== 'jev' || !jev || !exactKeys(jev, ['choice', 'confidence', 'selectedProbability', 'conditionChange',
      'independentMeaning', 'gateRecomputedByHarness'])
      || !(jev.choice === null || includesValue(jev.choice, JEV_CHOICES))
      || !['confidence', 'selectedProbability', 'conditionChange', 'independentMeaning'].every(key => nullableProbability(jev[key]))) return false;
    const gate = record(jev.gateRecomputedByHarness);
    if (!gate || !exactKeys(gate, ['status', 'reason', 'decision', 'gateVersion'])
      || !includesValue(gate.status, GATE_STATUSES) || !includesValue(gate.reason, GATE_REASONS)
      || !includesValue(gate.gateVersion, GATE_VERSIONS)
      || !(gate.decision === null || includesValue(gate.decision, ['target', 'remaining', 'completed', 'fallback']))) return false;
  }
  return true;
}
