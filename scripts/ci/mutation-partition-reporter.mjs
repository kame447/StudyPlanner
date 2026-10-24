import { scoreMutants } from './mutation-partition.mjs';

export function createReporterState() {
  return { initialized: false, wrapUpFinished: false, decision: null, failures: [], delegates: {} };
}
export const reporterState = createReporterState();

export function assertReporterComplete(state, mutantCount) {
  if (!state.initialized || !state.wrapUpFinished || !state.decision || state.failures.length || !Object.keys(state.delegates).length) throw new Error('Incomplete/failed mutation reporting lifecycle');
  for (const methods of Object.values(state.delegates)) {
    for (const [method, counts] of Object.entries(methods)) {
      const expected = method === 'onMutantTested' ? mutantCount : 1;
      if (counts.calls !== expected || counts.completed !== expected) throw new Error(`Incomplete reporter callback: ${method}`);
    }
  }
}

// Upstream BroadcastReporter catches delegate failures. Keep our own typed
// observation before a failure can reach that logging-only boundary.
export function strictReporter(delegates, state, breaking) {
  const pending = [];
  const methods = ['onDryRunCompleted', 'onMutationTestingPlanReady', 'onMutantTested', 'onMutationTestReportReady', 'wrapUp'];
  for (const [name, delegate] of Object.entries(delegates)) state.delegates[name] = Object.fromEntries(methods.filter(method => typeof delegate[method] === 'function').map(method => [method, { calls: 0, completed: 0 }]));
  const failed = (reporter, method, error) => { state.failures.push({ reporter, method, message: String(error?.message ?? error) }); };
  const call = (reporter, method, args) => {
    try {
      const counts = state.delegates[reporter][method];
      if (!counts) return;
      counts.calls++;
      const result = delegates[reporter][method]?.(...args);
      if (result?.then) pending.push(Promise.resolve(result).then(() => { counts.completed++; }, error => { failed(reporter, method, error); }));
      else counts.completed++;
    } catch (error) { failed(reporter, method, error); }
  };
  const broadcast = (method, args) => { for (const reporter of Object.keys(delegates)) call(reporter, method, args); };
  let drained = 0;
  const drain = async () => {
    while (drained < pending.length) { const batch = pending.slice(drained); drained = pending.length; await Promise.all(batch); }
  };
  state.initialized = true;
  return {
    onDryRunCompleted(...args) { broadcast('onDryRunCompleted', args); },
    onMutationTestingPlanReady(...args) { broadcast('onMutationTestingPlanReady', args); },
    onMutantTested(...args) { broadcast('onMutantTested', args); },
    onMutationTestReportReady(report, metrics) {
      try {
        const score = scoreMutants(Object.values(report.files).flatMap(file => file.mutants));
        const observed = metrics.systemUnderTestMetrics.metrics.mutationScore;
        if (breaking !== 50 || report.thresholds.break !== breaking
          || (score.valid ? observed !== score.score : !Number.isNaN(observed))) throw new Error('Reporter score policy/metrics mismatch');
        state.decision = { kind: !score.valid ? 'no-valid-mutants' : observed < breaking ? 'below-threshold' : 'at-or-above-threshold', breaking, detected: score.detected, valid: score.valid, score: score.score };
      } catch (error) { failed('score-observer', 'onMutationTestReportReady', error); }
      broadcast('onMutationTestReportReady', [report, metrics]);
    },
    async wrapUp() {
      await drain();
      broadcast('wrapUp', []);
      await drain();
      state.wrapUpFinished = true;
      if (state.failures.length) throw new Error('Mutation reporter operation failed');
    },
  };
}
