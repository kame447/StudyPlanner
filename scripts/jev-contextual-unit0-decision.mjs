import assert from 'node:assert/strict';
import { clopperPearsonUpper95 } from './jev-contextual-eval-metrics.mjs';
import { BOOTSTRAP_SEED, bootstrapReplicates } from './jev-contextual-unit0-random.mjs';
import { PREREGISTERED_PRICING, callCostFields } from './jev-contextual-unit0-budget.mjs';

// Preregistration r2 §2–§5, §9–§12, §15, §17. Values are fixed before any
// holdout output and are restated by the approval document, never read from it.
export const DECISION_RULES = Object.freeze({
  alpha: 0.05,
  nonInferiorityMargin: 0.05,
  d1MinimumPointReduction: 0.3,
  bootstrapReplicates: 20_000,
  latencyP50CapMs: 150, latencyP50CapFraction: 0.10,
  latencyP95CapMs: 500, latencyP95CapFraction: 0.10,
  costCapUsd: 0.0005, costCapFraction: 0.05,
  d1QuestionCode: 'quantity_role_unresolved',
});
const ARMS = ['jevFirst', 'lunaOnly'];
const COST_METHOD = 'bound_based_sufficient_condition: Jev-first upper bound vs Luna-only lower bound (§19c)';
// §19c replaces the §12 cost calculation with one bound-based rule: Jev-first
// is costed at an upper bound (Jev's reported cost for the same call, else its
// tariff bound; Luna usage at the cache-write input rate) and Luna-only at a
// lower bound (cached-input rate). T ≤ U, B ≥ L and a nondecreasing cap make
// this a conservative sufficient gate, reported as bound-based, never as
// measured spend. Every actual call counts; missing usage or a served tariff
// outside the frozen contract is unknown. A zero-dispatch arm costs 0.
function armCost(record, arm) {
  let total = 0;
  for (const dispatch of record.dispatches) {
    const fields = callCostFields(dispatch, PREREGISTERED_PRICING);
    const value = arm === 'jevFirst' ? fields.providerReportedCostUsd ?? fields.costUpperBoundUsd : fields.costLowerBoundUsd;
    // Complete usage is required even when Jev reported an amount (§19c).
    if (fields.tariffConforms !== true || !fields.usageComplete || value === null) return null;
    total += value;
  }
  return total;
}

// Nearest-rank: the ⌈q·n⌉-th value of the ascending sample (§12).
export function nearestRank(values, q) {
  assert.ok(values.length > 0 && Array.from(values).every(Number.isFinite));
  return Float64Array.from(values).sort()[Math.max(0, Math.ceil(q * values.length) - 1)];
}
const percentile = nearestRank;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const known = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
// Nearest-rank endpoints of the ascending replicate statistics (§11).
export const lowerRank = (replicates) => Math.ceil(DECISION_RULES.alpha * replicates);
export const upperRank = (replicates) => Math.ceil((1 - DECISION_RULES.alpha) * replicates);

function gate(status, detail) {
  assert.ok(['PASS', 'FAIL', 'UNKNOWN'].includes(status));
  return { status, ...detail };
}

// §2: critical errors in Jev-first's FINAL semantic outcome (any path), and
// joint false acceptance of Jev's direct acceptances; zero in B and C each.
function criticalErrors(roster, pairs, labels) {
  const strata = {};
  for (const stratum of roster.strata) {
    const cases = roster.cases.filter((item) => item.stratum === stratum.id);
    const count = (arm, predicate) => {
      const records = cases.map((item) => ({ record: pairs.get(item.id)?.[arm], label: labels.get(item.id + ':' + arm) ?? null }));
      if (records.some(({ record, label }) => !record?.observationComplete || label === null || typeof label.correct !== 'boolean')) return null;
      return records.filter(predicate).length;
    };
    strata[stratum.id] = {
      jevFirstFinalCritical: count('jevFirst', ({ label }) => label.criticalErrors.length > 0),
      jevFirstDirectJointFalseAcceptance: count('jevFirst', ({ record, label }) => record.directRoleAccepted && label.correct === false),
      jevFirstDirectAccepted: cases.filter((item) => pairs.get(item.id)?.jevFirst?.directRoleAccepted === true).length,
      // Reported only: a baseline error never excuses a treatment error.
      lunaOnlyFinalCritical: count('lunaOnly', ({ label }) => label.criticalErrors.length > 0),
    };
  }
  const values = Object.values(strata).flatMap((item) => [item.jevFirstFinalCritical, item.jevFirstDirectJointFalseAcceptance]);
  const status = values.some((value) => value === null) ? 'UNKNOWN' : values.every((value) => value === 0) ? 'PASS' : 'FAIL';
  return gate(status, { strata });
}

// §3/§10/§15: a group is harmed when any member is correct under Luna-only and
// wrong under Jev-first. Adoption uses only the zero-event bound on the mean
// harm rate; one or more harmed groups is HOLD. Bootstrap is never used here.
function nonInferiority(roster, pairs, labels) {
  let harmed = 0, unknownGroups = 0, groups = 0;
  const strata = {};
  const caseDifferences = [];
  for (const stratum of roster.strata) {
    let stratumHarm = 0;
    for (const group of stratum.groups) {
      groups += 1;
      let harm = false, unknown = false;
      for (const caseId of group.caseIds) {
        const jev = labels.get(caseId + ':jevFirst') ?? null;
        const luna = labels.get(caseId + ':lunaOnly') ?? null;
        if (typeof jev?.correct !== 'boolean' || typeof luna?.correct !== 'boolean') { unknown = true; continue; }
        if (luna.correct && !jev.correct) harm = true;
        caseDifferences.push(Number(jev.correct) - Number(luna.correct));
      }
      if (harm) { harmed += 1; stratumHarm += 1; } else if (unknown) unknownGroups += 1;
    }
    strata[stratum.id] = { groups: stratum.groups.length, harmedGroups: stratumHarm };
  }
  const zeroEventUpper = 1 - DECISION_RULES.alpha ** (1 / groups);
  const status = harmed > 0 ? 'FAIL' : unknownGroups > 0 ? 'UNKNOWN'
    : zeroEventUpper < DECISION_RULES.nonInferiorityMargin ? 'PASS' : 'FAIL';
  return gate(status, { groups, harmedGroups: harmed, unknownGroups, strata,
    upperMeanHarmRate: harmed === 0 && unknownGroups === 0 ? zeroEventUpper : null,
    margin: DECISION_RULES.nonInferiorityMargin,
    descriptive: { clopperPearsonUpperSameP: unknownGroups === 0 ? clopperPearsonUpper95(harmed, groups) : null,
      casePairedMeanCorrectnessChange: unknownGroups === 0 && caseDifferences.length === roster.cases.length ? mean(caseDifferences) : null,
      note: 'Descriptive only; not a gate. Synthetic purposive groups; independence is an authoring condition.' } });
}

function observedCase(pair) {
  return ARMS.every((arm) => pair?.[arm]?.observationComplete === true && Number.isSafeInteger(pair[arm].lunaDispatches)
    && known(pair[arm].elapsedMs));
}

// Bootstrap of §11/§12: one stream, one draw per replicate shared by every
// statistic. Groups are resampled within stratum; cases and pairs stay intact.
function bootstrap(roster, rows, replicates, seed) {
  const strata = roster.strata.map((stratum) => stratum.groups.map((group) => group.caseIds.map((id) => rows.get(id))));
  const output = { deltaAll: new Float64Array(replicates), deltaD1: new Float64Array(replicates),
    p50: { jevFirst: new Float64Array(replicates), lunaOnly: new Float64Array(replicates) },
    p95: { jevFirst: new Float64Array(replicates), lunaOnly: new Float64Array(replicates) },
    cost: { jevFirst: new Float64Array(replicates), lunaOnly: new Float64Array(replicates) } };
  let r = 0;
  for (const draw of bootstrapReplicates({ strata: strata.map((groups) => ({ groupCount: groups.length })), replicates, seed })) {
    const sample = draw.flatMap((indices, s) => indices.flatMap((index) => strata[s][index]));
    output.deltaAll[r] = mean(sample.map((row) => row.delta));
    const d1 = sample.filter((row) => row.d1);
    output.deltaD1[r] = d1.length ? mean(d1.map((row) => row.delta)) : -Infinity;
    for (const arm of ARMS) {
      const elapsed = sample.map((row) => row.elapsed[arm]);
      output.p50[arm][r] = percentile(elapsed, 0.5);
      output.p95[arm][r] = percentile(elapsed, 0.95);
      output.cost[arm][r] = row0CostKnown(sample) ? mean(sample.map((row) => row.cost[arm])) : NaN;
    }
    r += 1;
  }
  return output;
}
const row0CostKnown = (sample) => sample.every((row) => row.costKnown);

const sortedCopy = (values) => Float64Array.from(values).sort();
const endpoint = (values, rank) => sortedCopy(values)[rank - 1];

export function evaluateUnit0({ roster, pairs, labels, replicates = DECISION_RULES.bootstrapReplicates,
  seed = BOOTSTRAP_SEED, dryRun = false, runTerminal }) {
  assert.ok(runTerminal && ['PASS', 'FAIL', 'UNKNOWN'].includes(runTerminal.status), 'Run terminal validity is a required gate.');
  if (!dryRun) assert.equal(replicates, DECISION_RULES.bootstrapReplicates, 'Replicates are preregistered.');
  assert.ok(pairs instanceof Map && labels instanceof Map);
  const complete = roster.cases.every((item) => observedCase(pairs.get(item.id)));
  const labelsComplete = roster.cases.every((item) => ARMS.every((arm) => typeof labels.get(item.id + ':' + arm)?.correct === 'boolean'));
  const critical = criticalErrors(roster, pairs, labels);
  const noninferiority = nonInferiority(roster, pairs, labels);
  const unknownMeasurement = { status: 'UNKNOWN', reason: 'incomplete_observation' };
  let dispatch = unknownMeasurement, latency = unknownMeasurement, cost = unknownMeasurement, reported = null;
  if (complete) {
    const rows = new Map(roster.cases.map((item) => {
      const pair = pairs.get(item.id);
      const costs = { jevFirst: armCost(pair.jevFirst, 'jevFirst'), lunaOnly: armCost(pair.lunaOnly, 'lunaOnly') };
      return [item.id, { d1: item.questionCode === DECISION_RULES.d1QuestionCode, stratum: item.stratum,
        delta: pair.lunaOnly.lunaDispatches - pair.jevFirst.lunaDispatches,
        jevProviderCalls: pair.jevFirst.dispatches.filter((d) => d.provider === 'jev').length,
        elapsed: { jevFirst: pair.jevFirst.elapsedMs, lunaOnly: pair.lunaOnly.elapsedMs },
        cost: costs, costKnown: known(costs.jevFirst) && known(costs.lunaOnly) }];
    }));
    const all = [...rows.values()];
    const d1 = all.filter((row) => row.d1);
    const boot = bootstrap(roster, rows, replicates, seed);
    const low = lowerRank(replicates), high = upperRank(replicates);
    const allPoint = mean(all.map((row) => row.delta));
    const d1Point = d1.length ? mean(d1.map((row) => row.delta)) : null;
    const allLower = endpoint(boot.deltaAll, low);
    const d1Lower = endpoint(boot.deltaD1, low);
    const d1Pass = d1Point !== null && d1Point >= DECISION_RULES.d1MinimumPointReduction && d1Lower > 0;
    const allPass = allPoint >= 0 && allLower >= 0;
    dispatch = gate(d1Pass && allPass ? 'PASS' : 'FAIL', {
      definition: 'semantic Luna dispatches, Luna-only minus Jev-first; positive is a saving',
      d1: { cases: d1.length, point: d1Point, lower95: Number.isFinite(d1Lower) ? d1Lower : null,
        lowerIsNegativeInfinity: d1Lower === -Infinity, pass: d1Pass },
      allTurns: { cases: all.length, point: allPoint, lower95: allLower, pass: allPass },
      byStratum: Object.fromEntries(roster.strata.map(({ id }) => {
        const rowsIn = all.filter((row) => row.stratum === id);
        return [id, { cases: rowsIn.length, point: mean(rowsIn.map((row) => row.delta)) }];
      })),
      note: 'All-zero differences give point 0 and lower bound 0 on the observed sample only; this does not guarantee unobserved tails.',
    });
    // §5/§12: caps are zero unless the dispatch gate passed; a zero baseline
    // yields a zero cap automatically through the fractional term.
    const allowTradeoff = dispatch.status === 'PASS';
    const capFor = (baseline, absolute, fraction) => allowTradeoff ? Math.min(absolute, fraction * baseline) : 0;
    const excess = (jev, luna, absolute, fraction) => (jev - luna) - capFor(luna, absolute, fraction);
    const quantileGate = (q, absolute, fraction) => {
      const jev = all.map((row) => row.elapsed.jevFirst), luna = all.map((row) => row.elapsed.lunaOnly);
      const pointJev = percentile(jev, q), pointLuna = percentile(luna, q);
      const point = excess(pointJev, pointLuna, absolute, fraction);
      const key = q === 0.5 ? 'p50' : 'p95';
      const replicateExcess = boot[key].jevFirst.map((value, r) => excess(value, boot[key].lunaOnly[r], absolute, fraction));
      const upper = endpoint(replicateExcess, high);
      return { jevFirst: pointJev, lunaOnly: pointLuna, difference: pointJev - pointLuna,
        cap: capFor(pointLuna, absolute, fraction), excessPoint: point, excessUpper95: upper, pass: point <= 0 && upper <= 0 };
    };
    const p50 = quantileGate(0.5, DECISION_RULES.latencyP50CapMs, DECISION_RULES.latencyP50CapFraction);
    const p95 = quantileGate(0.95, DECISION_RULES.latencyP95CapMs, DECISION_RULES.latencyP95CapFraction);
    latency = gate(p50.pass && p95.pass ? 'PASS' : 'FAIL', { tradeoffAllowed: allowTradeoff, p50, p95,
      secondaryMedianPairedDifference: percentile(all.map((row) => row.elapsed.jevFirst - row.elapsed.lunaOnly), 0.5) });
    if (!all.every((row) => row.costKnown)) {
      cost = gate('UNKNOWN', { method: COST_METHOD, reason: 'usage_or_tariff_unverifiable', missingArmRecords: all.reduce((sum, row) =>
        sum + ARMS.filter((arm) => !known(row.cost[arm])).length, 0) });
    } else {
      const jevMean = mean(all.map((row) => row.cost.jevFirst)), lunaMean = mean(all.map((row) => row.cost.lunaOnly));
      const point = excess(jevMean, lunaMean, DECISION_RULES.costCapUsd, DECISION_RULES.costCapFraction);
      const upper = endpoint(boot.cost.jevFirst.map((value, r) => excess(value, boot.cost.lunaOnly[r],
        DECISION_RULES.costCapUsd, DECISION_RULES.costCapFraction)), high);
      cost = gate(point <= 0 && upper <= 0 ? 'PASS' : 'FAIL', { method: COST_METHOD, tradeoffAllowed: allowTradeoff,
        jevFirstUpperBoundMeanUsd: jevMean, lunaOnlyLowerBoundMeanUsd: lunaMean, cap: capFor(lunaMean, DECISION_RULES.costCapUsd, DECISION_RULES.costCapFraction),
        excessPoint: point, excessUpper95: upper });
    }
    reported = { jevProviderCallsPerTurn: mean(all.map((row) => row.jevProviderCalls)),
      rawLunaFreeRate: Object.fromEntries(ARMS.map((arm) => [arm, mean(roster.cases.map((item) => Number(pairs.get(item.id)[arm].lunaDispatches === 0)))])),
      correctAndLunaFreeRate: labelsComplete ? Object.fromEntries(ARMS.map((arm) => [arm, mean(roster.cases.map((item) =>
        Number(pairs.get(item.id)[arm].lunaDispatches === 0 && labels.get(item.id + ':' + arm).correct)))])) : null };
  }
  const gates = { runTerminal: gate(runTerminal.status, { failures: runTerminal.failures ?? [] }), criticalErrors: critical, nonInferiority: noninferiority, dispatchReduction: dispatch,
    latency, cost,
    completeness: gate(complete && labelsComplete ? 'PASS' : 'UNKNOWN', { observationsComplete: complete, labelsComplete,
      cases: roster.cases.length }) };
  const allPass = Object.values(gates).every((item) => item.status === 'PASS');
  return { researchGates: allPass ? 'PASS' : 'HOLD',
    failing: Object.entries(gates).filter(([, item]) => item.status !== 'PASS').map(([name, item]) => name + ':' + item.status),
    census: 'not_evaluated_here_separate_adoption_condition',
    adoption: 'HOLD', production: 'not_authorized',
    dryRun, replicates, bootstrapSeed: seed, pricingVersion: PREREGISTERED_PRICING.version, gates, reported };
}
