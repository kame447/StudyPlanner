import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';

// Preregistration r2 §6 / B6 with §19a (r8). These are the frozen execution
// limits for the one approved holdout run; a real run refuses any other value.
// Dry-runs may lower them only to demonstrate the stop paths, and their output
// is never evidence. totalBudgetUsd is a hard cap on settled cost plus open
// reservations, checked before every physical provider send.
export const PREREGISTERED_LIMITS = Object.freeze({
  normalizerTurns: 260,
  totalBudgetUsd: 5,
  totalDispatches: 2080,
  dispatchesPerTurn: 8,
  totalElapsedMs: 5_400_000,
  maxProviderFailureRate: 0.2,
});
// §19a/§19c frozen tariff contract, restated by the approval and compared,
// never read from it. The Luna input upper bound (cache write = 1.25 × 0.20)
// and lower bound (cached input) hold only under this standard text tariff;
// another tier, surcharge, long-context multiplier or unverifiable contract
// voids both bounds. The 60,000-token input cap excludes the 272k regime.
export const PREREGISTERED_PRICING = Object.freeze({
  version: 'unit0-r2-tariff-2026-10-05',
  // Served IDs are matched exactly (§19d); no prefix or "latest" widening.
  luna: Object.freeze({ endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna', serviceTier: 'standard',
    servedModels: Object.freeze(['gpt-5.6-luna']),
    tariff: Object.freeze({ inputUsdPerMillionTokens: 0.2, cachedInputUsdPerMillionTokens: 0.02, outputUsdPerMillionTokens: 1.2,
      cacheWriteMultiplier: 1.25 }),
    upperInputUsdPerMillionTokens: 0.25, lowerInputUsdPerMillionTokens: 0.02, outputUsdPerMillionTokens: 1.2,
    perCallMarginUsd: 0.0001, inputTokenOverheadPerCall: 512, maxInputTokensPerCall: 60_000, maxOutputTokensPerCall: 8_000,
    sources: Object.freeze(['https://developers.openai.com/api/docs/models/gpt-5.6-luna', 'https://developers.openai.com/api/docs/pricing']),
    verifiedAt: '2026-10-04' }),
  jev: Object.freeze({ endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13',
    servedModels: Object.freeze(['typesafe/jev-1.13', 'typesafe/jev-1.13-20260917']),
    inputUsdPerMillionTokens: 0.042, outputUsdPerMillionTokens: 0,
    perCallMarginUsd: 0.0001, inputTokenOverheadPerCall: 512, maxInputTokensPerCall: 60_000,
    sources: Object.freeze(['https://openrouter.ai/typesafe/jev-1.13/api',
      'https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints']), verifiedAt: '2026-10-04' }),
});
// Served-condition check on a provider response. null = no response to judge
// (the call's usage is then missing anyway). false voids the bounds and stops
// the run. Luna conforms only when it reports service_tier "default" (the
// request pins it explicitly); an absent tier is never assumed standard.
export function tariffConforms(dispatch, pricing) {
  if (dispatch.servedModel === null && dispatch.serviceTier === null) return null;
  if (dispatch.provider === 'jev') return pricing.jev.servedModels.includes(dispatch.servedModel) && dispatch.serviceTier === null;
  return pricing.luna.servedModels.includes(dispatch.servedModel) && dispatch.serviceTier === 'default';
}

// Eval token lifetime is unchanged (30 min). A run is split into Worker
// segments with fresh tokens; a turn starts only when the segment can outlive
// the turn's maximum duration plus a clock-skew margin.
export const SEGMENT_TOKEN_LIFETIME_MS = 30 * 60_000;
export const TURN_TIMEOUT_MS = 300_000;
export const TOKEN_SKEW_MARGIN_MS = 60_000;

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;

// Per-call reservation computed inside the Worker immediately before the
// send: (UTF-8 request bytes + framing overhead) × input rate + this call's own
// max_completion_tokens × output rate + a fixed margin. UTF-8 bytes bound the
// input tokens of a byte-level BPE tokenizer. Jev sends no output limit and is
// priced at zero output, so its reservation is input plus margin only.
export function validatePricing(pricing) {
  assert.ok(pricing && typeof pricing === 'object', 'Pricing contract is required.');
  assert.ok(typeof pricing.version === 'string' && pricing.version, 'Pricing contract needs a version.');
  for (const provider of ['luna', 'jev']) {
    const rates = pricing[provider];
    assert.ok(rates && typeof rates.model === 'string' && rates.model && typeof rates.endpoint === 'string',
      'Pricing needs a pinned endpoint and model: ' + provider);
    assert.ok(Array.isArray(rates.sources) && rates.sources.length > 0, 'Pricing needs primary sources: ' + provider);
    assert.ok(Array.isArray(rates.servedModels) && rates.servedModels.length > 0
      && rates.servedModels.every((id) => typeof id === 'string' && id), 'Pricing needs the exact served IDs: ' + provider);
    for (const key of ['outputUsdPerMillionTokens', 'perCallMarginUsd', ...(provider === 'luna'
      ? ['upperInputUsdPerMillionTokens', 'lowerInputUsdPerMillionTokens'] : ['inputUsdPerMillionTokens'])]) {
      assert.ok(nonnegative(rates[key]), `Invalid ${provider} rate: ${key}`);
    }
    assert.ok(count(rates.inputTokenOverheadPerCall) && count(rates.maxInputTokensPerCall)
      && rates.maxInputTokensPerCall > rates.inputTokenOverheadPerCall, 'Invalid input bound: ' + provider);
  }
  const { luna } = pricing;
  assert.ok(count(luna.maxOutputTokensPerCall) && luna.maxOutputTokensPerCall > 0);
  // The bounds must follow from the cited tariff, not be free parameters.
  assert.ok(Math.abs(luna.upperInputUsdPerMillionTokens - luna.tariff.inputUsdPerMillionTokens * luna.tariff.cacheWriteMultiplier) < 1e-12
    && luna.upperInputUsdPerMillionTokens >= luna.tariff.inputUsdPerMillionTokens, 'Luna upper input rate does not follow from the tariff.');
  assert.ok(luna.lowerInputUsdPerMillionTokens <= luna.tariff.cachedInputUsdPerMillionTokens
    && luna.lowerInputUsdPerMillionTokens <= luna.tariff.inputUsdPerMillionTokens, 'Luna lower input rate does not follow from the tariff.');
  assert.equal(luna.outputUsdPerMillionTokens, luna.tariff.outputUsdPerMillionTokens);
  assert.ok(luna.maxInputTokensPerCall < 272_000, 'The long-context tariff regime must stay excluded.');
  assert.equal(pricing.jev.outputUsdPerMillionTokens, 0, 'Jev reservation has no output term; a priced output needs a new contract.');
  assert.ok(typeof pricing.source === 'string' && pricing.source.trim(), 'Pricing source must be recorded.');
  return pricing;
}

// Rates the Worker applies before each send (the Luna reservation uses the
// upper input rate).
export const workerRates = (pricing) => ({
  luna: { endpoint: pricing.luna.endpoint, model: pricing.luna.model, servedModels: [...pricing.luna.servedModels],
    inputUsdPerMillionTokens: pricing.luna.upperInputUsdPerMillionTokens,
    outputUsdPerMillionTokens: pricing.luna.outputUsdPerMillionTokens, perCallMarginUsd: pricing.luna.perCallMarginUsd,
    inputTokenOverheadPerCall: pricing.luna.inputTokenOverheadPerCall, maxInputTokensPerCall: pricing.luna.maxInputTokensPerCall,
    maxOutputTokensPerCall: pricing.luna.maxOutputTokensPerCall },
  jev: { endpoint: pricing.jev.endpoint, model: pricing.jev.model, servedModels: [...pricing.jev.servedModels],
    inputUsdPerMillionTokens: pricing.jev.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: 0, perCallMarginUsd: pricing.jev.perCallMarginUsd,
    inputTokenOverheadPerCall: pricing.jev.inputTokenOverheadPerCall, maxInputTokensPerCall: pricing.jev.maxInputTokensPerCall },
});

export const callReserveUsd = (rates, inputBound, requestedOutputTokens = 0) => rates.perCallMarginUsd
  + inputBound * rates.inputUsdPerMillionTokens / 1e6 + requestedOutputTokens * rates.outputUsdPerMillionTokens / 1e6;

// The largest reservation any single call can make under the declared maxima.
export function reservePerCallUsd(pricing) {
  validatePricing(pricing);
  const rates = workerRates(pricing);
  const reserve = Math.max(callReserveUsd(rates.luna, rates.luna.maxInputTokensPerCall, rates.luna.maxOutputTokensPerCall),
    callReserveUsd(rates.jev, rates.jev.maxInputTokensPerCall));
  assert.ok(positive(reserve), 'A zero reservation cannot bound spend.');
  return reserve;
}

// Per-call cost fields (§19c), kept distinct and each with its basis:
// providerReportedCostUsd (Jev's reported amount for that same call),
// costUpperBoundUsd and costLowerBoundUsd (reported usage × the frozen tariff
// bounds). A call with no conforming response, or missing usage, has null
// bounds; nothing here is "measured spend".
const tokenCount = (value) => Number.isSafeInteger(value) && value >= 0;
// Complete usage (both token counts) is a precondition for every bound and
// for any settlement: a reported amount never stands in for missing usage.
export function callCostFields(dispatch, pricing) {
  const conforms = tariffConforms(dispatch, pricing);
  const usageComplete = tokenCount(dispatch.inputTokens) && tokenCount(dispatch.outputTokens);
  // Recorded whenever the provider reported it; usable only with complete usage.
  const reported = dispatch.provider === 'jev' && nonnegative(dispatch.costUsd) ? dispatch.costUsd : null;
  let upper = null, lower = null;
  if (conforms === true && usageComplete) {
    if (dispatch.provider === 'jev') {
      upper = lower = dispatch.inputTokens * pricing.jev.inputUsdPerMillionTokens / 1e6;
    } else {
      const output = dispatch.outputTokens * pricing.luna.outputUsdPerMillionTokens / 1e6;
      upper = dispatch.inputTokens * pricing.luna.upperInputUsdPerMillionTokens / 1e6 + output;
      lower = dispatch.inputTokens * pricing.luna.lowerInputUsdPerMillionTokens / 1e6 + output;
    }
  }
  return { providerReportedCostUsd: reported, costUpperBoundUsd: upper, costLowerBoundUsd: lower,
    usageComplete, tariffConforms: conforms, pricingVersion: pricing.version,
    basis: dispatch.provider === 'jev' ? 'openrouter typesafe/jev-1.13 input rate; reported cost same call' : 'openai standard text gpt-5.6-luna; input cache-write upper / cached-input lower' };
}
// Budget settlement uses the reported cost or the sound upper bound, never a
// lower bound; otherwise the reservation stays open.
export function settlementUsd(dispatch, pricing) {
  const fields = callCostFields(dispatch, pricing);
  if (!fields.usageComplete || fields.tariffConforms !== true) return { amountUsd: null, basis: 'reservation_held', fields };
  if (fields.providerReportedCostUsd !== null) return { amountUsd: fields.providerReportedCostUsd, basis: 'provider_reported', fields };
  if (fields.costUpperBoundUsd !== null) return { amountUsd: fields.costUpperBoundUsd, basis: 'tariff_upper_bound', fields };
  return { amountUsd: null, basis: 'reservation_held', fields };
}

export function validateLimits(limits, { dryRun }) {
  for (const key of Object.keys(PREREGISTERED_LIMITS)) {
    assert.ok(positive(limits?.[key]), 'Missing execution limit: ' + key);
    if (!dryRun) assert.equal(limits[key], PREREGISTERED_LIMITS[key], 'Execution limit differs from preregistration: ' + key);
    else assert.ok(limits[key] <= PREREGISTERED_LIMITS[key], 'Dry-run may only tighten limits: ' + key);
  }
  assert.ok(Object.keys(limits).every((key) => Object.hasOwn(PREREGISTERED_LIMITS, key)), 'Unknown execution limit.');
  return limits;
}

// Preregistration §17/§18/§18a. Every actual provider attempt is in the
// denominator. Infrastructure failures (HTTP 5xx, 429, 408, network, timeout)
// are the numerator, symmetrically for Luna and Jev. A configuration or
// permission failure (any other non-2xx, or a served-model mismatch) stops the
// run immediately. invalid_response is a counted attempt but not a numerator.
export const ATTEMPT_OUTCOMES = ['response', 'invalid_response', 'http_failure', 'network_failure', 'timeout', 'model_mismatch'];
export function classifyAttempt(dispatch) {
  switch (dispatch.outcome) {
    case 'response': return 'ok';
    case 'invalid_response': return 'invalid';
    case 'network_failure': case 'timeout': return 'infra';
    case 'model_mismatch': return 'config';
    case 'http_failure': {
      const status = dispatch.httpStatus;
      assert.ok(Number.isSafeInteger(status) && status >= 100 && status <= 599, 'HTTP failure needs its status.');
      return status >= 500 || status === 429 || status === 408 ? 'infra' : 'config';
    }
    default: throw new assert.AssertionError({ message: 'Unknown attempt outcome.' });
  }
}
export const FAILURE_RATE_MINIMUM_ATTEMPTS = 20;
export const EARLY_CONSECUTIVE_INFRA_FAILURES = 5;

// Append-only consumption ledger. Every write is flushed before the next
// provider-exposing action. The ledger is the single record across segments:
// totals, clock and consumption are never reset by a token rotation.
// An unsettled turn (lost response, expiry, crash) is never given invented
// observations: only dispatches actually observed are kept as a lower bound,
// and the worst-case allowance is a separate budget hold used only for caps.
export class ConsumptionLedger {
  static async create(path, header) {
    const handle = await open(path, 'wx'); // never reopened: no automatic rerun
    const ledger = new ConsumptionLedger(handle, header);
    await ledger.append({ type: 'run_started', ...header });
    return ledger;
  }

  constructor(handle, header) {
    this.handle = handle;
    this.entries = [];
    this.limits = header.limits;
    this.pricing = validatePricing(header.pricing);
    this.reserveUsd = reservePerCallUsd(header.pricing);
    this.state = { settledUsd: 0, openReservationUsd: 0, providerReportedUsd: 0, upperBoundSettledUsd: 0, actualCostKnown: true,
      observedDispatches: 0, heldDispatches: 0, pricingViolations: 0, infraFailures: 0, latchedStop: null, consecutiveInfraFailures: 0, configFailures: 0,
      settledTurns: 0, unsettledTurns: 0 };
  }

  async append(entry) {
    const record = { sequence: this.entries.length, ...entry };
    this.entries.push(record);
    if (this.handle) {
      await this.handle.appendFile(JSON.stringify(record) + '\n');
      await this.handle.sync();
    }
    return record;
  }

  // Hard budget left for new reservations: USD 5 − settlements − open reservations.
  remainingUsd() { return this.limits.totalBudgetUsd - this.state.settledUsd - this.state.openReservationUsd; }
  capUsd() { return this.state.settledUsd + this.state.openReservationUsd; }
  capDispatches() { return this.state.observedDispatches + this.state.heldDispatches; }
  failureRate() {
    return this.state.observedDispatches ? this.state.infraFailures / this.state.observedDispatches : null;
  }

  // Full worst-case admission: a turn starts only when 8 maximal reservations
  // and 8 attempts still fit, so the caps never cut a turn after it began.
  // The remaining budget is also passed to the Worker, which refuses any send
  // whose reservation would exceed it.
  admission({ elapsedMs }) {
    const { limits, state } = this;
    const turnReserve = limits.dispatchesPerTurn * this.reserveUsd;
    const stop = this.stopReason();
    if (stop) return { admit: false, reason: stop };
    if (state.settledTurns + state.unsettledTurns >= limits.normalizerTurns) return { admit: false, reason: 'turn_cap_reached' };
    if (this.capDispatches() + limits.dispatchesPerTurn > limits.totalDispatches) return { admit: false, reason: 'dispatch_cap_reached' };
    if (turnReserve > this.remainingUsd() + 1e-12) return { admit: false, reason: 'budget_cap_reached' };
    if (elapsedMs >= limits.totalElapsedMs) return { admit: false, reason: 'elapsed_cap_reached' };
    return { admit: true, allowance: { dispatches: limits.dispatchesPerTurn, reservedUsd: turnReserve,
      budgetRemainingUsd: this.remainingUsd(), runState: this.runState() } };
  }

  // Evaluated after every physical attempt; the first crossing is latched.
  latchAfterAttempt() {
    const { state, limits } = this;
    if (state.latchedStop !== null) return;
    if (state.configFailures > 0) state.latchedStop = 'configuration_failure';
    else if (state.observedDispatches >= FAILURE_RATE_MINIMUM_ATTEMPTS) {
      if (this.failureRate() > limits.maxProviderFailureRate) state.latchedStop = 'provider_failure_rate_exceeded';
    } else if (state.consecutiveInfraFailures >= EARLY_CONSECUTIVE_INFRA_FAILURES) {
      state.latchedStop = 'consecutive_infrastructure_failures';
    }
  }

  // Run-wide state handed to the Worker so it applies the same rule per send.
  runState() {
    return { attempts: this.state.observedDispatches, infrastructureFailures: this.state.infraFailures,
      consecutiveInfrastructureFailures: this.state.consecutiveInfraFailures };
  }

  stopReason() {
    const { state } = this;
    if (state.unsettledTurns > 0) return 'unsettled_turn';
    if (state.latchedStop !== null) return state.latchedStop;
    if (state.configFailures > 0) return 'configuration_failure';
    if (state.pricingViolations > 0) return 'pricing_contract_violated';
    return null; // rate and consecutive stops are latched per attempt
  }

  async admit(turn) {
    return this.append({ type: 'turn_admitted', ...turn });
  }

  async settle(turn, record, allowance) {
    const dispatches = record.dispatches;
    const reservations = record.preSend.reservations;
    assert.ok(dispatches.length <= this.limits.dispatchesPerTurn, 'Worker exceeded its per-turn allowance.');
    assert.equal(reservations.length, dispatches.length, 'Worker reservation disagrees with dispatches.');
    assert.ok(reservations.every((value) => value > 0 && value <= this.reserveUsd + 1e-12),
      'A call reservation exceeds the preregistered per-call maximum.');
    if (allowance) {
      assert.ok(record.preSend.reservedUsd <= allowance.budgetRemainingUsd + 1e-12, 'Worker reserved beyond the remaining budget.');
    }
    let infra = 0;
    const settlement = dispatches.map((dispatch, index) => {
      const kind = classifyAttempt(dispatch);
      this.state.observedDispatches += 1;
      if (kind === 'infra') { infra += 1; this.state.infraFailures += 1; this.state.consecutiveInfraFailures += 1; }
      else this.state.consecutiveInfraFailures = 0;
      if (kind === 'config') this.state.configFailures += 1;
      this.latchAfterAttempt(); // a crossing inside the turn cannot be diluted by later results
      const settled = settlementUsd(dispatch, this.pricing);
      // A served tariff condition outside the frozen contract, or a charge
      // above the call's reservation, means the hard cap is no longer
      // provable: keep the reservation and stop the run.
      if (settled.fields.tariffConforms === false) this.state.pricingViolations += 1;
      if (settled.amountUsd !== null && settled.amountUsd > reservations[index] + 1e-12) this.state.pricingViolations += 1;
      if (settled.fields.providerReportedCostUsd !== null) this.state.providerReportedUsd += settled.fields.providerReportedCostUsd;
      if (settled.amountUsd === null) {
        this.state.openReservationUsd += reservations[index]; // missing usage keeps the reservation
        this.state.actualCostKnown = false;
      } else {
        this.state.settledUsd += Math.max(settled.amountUsd, 0);
        if (settled.basis === 'tariff_upper_bound') this.state.upperBoundSettledUsd += settled.amountUsd;
      }
      return { provider: dispatch.provider, phase: dispatch.phase, status: dispatch.status, outcome: dispatch.outcome,
        httpStatus: dispatch.httpStatus, servedModel: dispatch.servedModel, serviceTier: dispatch.serviceTier,
        reservedUsd: reservations[index], settlementUsd: settled.amountUsd, settlementBasis: settled.basis, ...settled.fields };
    });
    this.state.settledTurns += 1;
    return this.append({ type: 'turn_settled', ...turn, dispatches: settlement, infrastructureFailures: infra,
      refusedSends: record.preSend.refusedSends, workerStopLatched: record.preSend.stopLatched ?? null,
      ledgerStopLatched: this.state.latchedStop, elapsedMs: record.elapsedMs, totals: this.totals() });
  }

  // An unsettled turn (lost response, expiry, unverifiable record) is never
  // given invented observations: observed attempts are a lower bound, and the
  // whole admitted allowance stays reserved as a separate budget hold.
  async unsettled(turn, allowance, reason, observedDispatches = []) {
    Object.assign(this.state, {
      openReservationUsd: this.state.openReservationUsd + allowance.reservedUsd,
      observedDispatches: this.state.observedDispatches + observedDispatches.length,
      heldDispatches: this.state.heldDispatches + Math.max(0, allowance.dispatches - observedDispatches.length),
      unsettledTurns: this.state.unsettledTurns + 1,
      actualCostKnown: false,
    });
    return this.append({ type: 'turn_unsettled', ...turn, reason,
      observedDispatchesLowerBound: observedDispatches.length, totalDispatches: null, usage: null,
      budgetHold: { dispatches: allowance.dispatches, reservedUsd: allowance.reservedUsd,
        meaning: 'operational cap and budget hold only; never a measurement' },
      totals: this.totals() });
  }

  totals() {
    const { state } = this;
    return { settlementUsd: state.settledUsd, settledByUpperBoundUsd: state.upperBoundSettledUsd,
      openReservationUsd: state.openReservationUsd, capChargedUsd: this.capUsd(), remainingUsd: this.remainingUsd(),
      providerReportedCostUsd: state.providerReportedUsd, allCallsSettled: state.actualCostKnown,
      observedDispatches: state.observedDispatches, budgetHoldDispatches: state.heldDispatches,
      capChargedDispatches: this.capDispatches(), infrastructureFailures: state.infraFailures,
      infrastructureFailureRate: this.failureRate(), consecutiveInfrastructureFailures: state.consecutiveInfraFailures,
      configurationFailures: state.configFailures, pricingContractViolations: state.pricingViolations,
      latchedStop: state.latchedStop, settledTurns: state.settledTurns, unsettledTurns: state.unsettledTurns };
  }

  async close(type, detail) {
    try { await this.append({ type, ...detail, totals: this.totals() }); }
    finally { await this.handle?.close(); this.handle = null; }
  }
}

// A pair (both arms) is started only when the segment can host both turns.
export const ARM_TOKEN_RESERVE_MS = TURN_TIMEOUT_MS + TOKEN_SKEW_MARGIN_MS;
export function segmentCanHost(segment, now, arms) {
  return segment !== null && now + arms * ARM_TOKEN_RESERVE_MS <= segment.expiresAt;
}
