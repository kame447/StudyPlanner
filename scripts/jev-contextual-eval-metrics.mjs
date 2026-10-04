// Missing observations invalidate a total; a known absence of dispatch is zero.
export function observedTotal(values) {
  if (values.some((value) => typeof value !== 'number'
    || !Number.isFinite(value) || value < 0)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function observedLunaUsage(records, field) {
  if (records.some((record) => typeof record.lunaCalled !== 'boolean')) return null;
  return observedTotal(records.filter((record) => record.lunaCalled).map((record) => record[field]));
}

export function percentile(values, quantile) {
  if (values.length === 0 || values.some((value) => typeof value !== 'number'
    || !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

export function clopperPearsonUpper95(errors, total) {
  if (!total) return null;
  if (errors >= total) return 1;
  let low = 0, high = 1;
  for (let step = 0; step < 80; step += 1) {
    const p = (low + high) / 2;
    let term = (1 - p) ** total, cdf = term;
    for (let k = 0; k < errors; k += 1) {
      term *= (total - k) / (k + 1) * p / (1 - p);
      cdf += term;
    }
    if (cdf > 0.05) low = p; else high = p;
  }
  return high;
}

export function summarizePairs(pairs, { cases } = {}) {
  const denominator = cases?.length ?? pairs.length;
  const arm = (name) => {
    const records = pairs.map((pair) => pair[name]);
    const observed = records.filter((record) => record?.observationComplete === true
      && Number.isSafeInteger(record.lunaDispatches) && record.lunaDispatches >= 0);
    const complete = observed.length === denominator;
    const jointJudged = observed.filter((record) => typeof record.jointCorrect === 'boolean');
    const dispatches = complete
      ? observedTotal(records.map((record) => record.lunaDispatches)) : null;
    const accepted = records.filter((record) => record?.directRoleAccepted);
    const judged = accepted.filter((record) => typeof record.jointCorrect === 'boolean');
    const falseAccepts = judged.filter((record) => !record.jointCorrect);
    const d1 = records.filter((record) => record?.questionCode === 'quantity_role_unresolved');
    const d1Denominator = cases ? cases.filter((item) => item.questionCode === 'quantity_role_unresolved').length : d1.length;
    const free = complete ? records.filter((record) => record.lunaDispatches === 0) : [];
    return {
      turns: denominator, observedTurns: records.filter(Boolean).length,
      unobservedTurns: denominator - observed.length,
      jointJudgedTurns: jointJudged.length, jointUnknownTurns: denominator - jointJudged.length,
      observationComplete: complete,
      lunaDispatches: dispatches,
      lunaDispatchesPerTurn: dispatches === null || !records.length ? null : dispatches / records.length,
      rawDispatchFreeRate: complete && records.length ? free.length / records.length : null,
      correctResolutionAndFreeRate: complete && records.length
        && free.every((record) => typeof record.jointCorrect === 'boolean')
        ? free.filter((record) => record.jointCorrect).length / records.length : null,
      mutatingCommitRate: null, // semantic harness does not execute application commit
      d1DirectAcceptance: { count: d1.filter((record) => record.directRoleAccepted).length,
        denominator: d1Denominator, rate: complete && d1Denominator ? d1.filter((record) => record.directRoleAccepted).length / d1Denominator : null },
      jointFalseAcceptance: { count: falseAccepts.length, judged: judged.length,
        accepted: accepted.length, unjudged: accepted.length - judged.length,
        rate: complete && judged.length === accepted.length && accepted.length ? falseAccepts.length / accepted.length : null,
        upper95Cases: complete && judged.length === accepted.length ? clopperPearsonUpper95(falseAccepts.length, accepted.length) : null,
        upper95Groups: complete && judged.length === accepted.length ? clopperPearsonUpper95(
          new Set(falseAccepts.map((record) => record.group)).size,
          new Set(accepted.map((record) => record.group)).size) : null },
      jointCorrectness: complete && records.every((record) => typeof record?.jointCorrect === 'boolean')
        && records.length ? records.filter((record) => record.jointCorrect).length / records.length : null,
      semanticLatencyMs: { kind: 'measured_elapsed', p50: complete ? percentile(records.map((record) => record.elapsedMs), 0.5) : null,
        p95: complete ? percentile(records.map((record) => record.elapsedMs), 0.95) : null },
      usage: { inputTokens: complete ? observedTotal(records.map((record) => record.inputTokens)) : null,
        outputTokens: complete ? observedTotal(records.map((record) => record.outputTokens)) : null,
        actualCostUsd: complete ? observedTotal(records.map((record) => record.actualCostUsd)) : null },
    };
  };
  const jevFirst = arm('jevFirst');
  const lunaOnly = arm('lunaOnly');
  const differences = pairs.map((pair) => pair.jevFirst?.observationComplete && pair.lunaOnly?.observationComplete
    && Number.isSafeInteger(pair.jevFirst.lunaDispatches) && Number.isSafeInteger(pair.lunaOnly.lunaDispatches)
    ? pair.jevFirst.lunaDispatches - pair.lunaOnly.lunaDispatches : null);
  return {
    status: 'HOLD', adoption: 'not_evaluated_against_owner_thresholds',
    population: 'synthetic_weekly_planning_contextual_turns',
    denominator, observedPairs: pairs.filter((pair) => pair.jevFirst && pair.lunaOnly).length,
    groups: new Set((cases ?? pairs).map((pair) => pair.group)).size,
    labelSources: [...new Set(pairs.flatMap((pair) => [pair.labelSource, pair.jevFirst?.jointLabel?.source, pair.lunaOnly?.jointLabel?.source]).filter(Boolean))],
    jevFirst, lunaOnly,
    pairedLunaDispatchDifferencePerTurn: differences.length === denominator && denominator && differences.every((value) => value !== null)
      ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null,
    note: 'All actual semantic calls in each normalization turn, including generic fallback/repair/retry; no renderer. Null is NA, never zero. Synthetic labels are not gold. Commit rate needs application evaluation.',
  };
}
