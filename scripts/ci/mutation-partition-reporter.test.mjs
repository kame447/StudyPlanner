import { describe, expect, it } from 'vitest';
import { assertReporterComplete, createReporterState, strictReporter } from './mutation-partition-reporter.mjs';

const report = { thresholds: { break: 50 }, files: { source: { mutants: [{ status: 'Survived' }] } } };
const metrics = { systemUnderTestMetrics: { metrics: { mutationScore: 0 } } };
describe('independent reporter lifecycle observation', () => {
  it('drains every delegate callback and records positive completion plus a typed threshold decision', async () => {
    const state = createReporterState();
    let completed = false;
    const reporter = strictReporter({ json: { async onMutationTestReportReady() { await Promise.resolve(); completed = true; }, wrapUp() {} } }, state, 50);
    reporter.onMutationTestReportReady(report, metrics);
    await reporter.wrapUp();
    assertReporterComplete(state, 1);
    expect(completed).toBe(true);
    expect(state.decision).toMatchObject({ kind: 'below-threshold', breaking: 50, detected: 0, valid: 1 });
  });
  it('does not accept complete outputs when wrapUp fails and the broadcaster catches it', async () => {
    let outputWritten = false;
    const state = createReporterState();
    const reporter = strictReporter({ json: { onMutationTestReportReady() { outputWritten = true; }, async wrapUp() { throw new Error('disk flush failed after complete output'); } } }, state, 50);
    reporter.onMutationTestReportReady(report, metrics);
    await reporter.wrapUp().catch(() => {});
    expect(outputWritten).toBe(true);
    expect(state.failures).toMatchObject([{ reporter: 'json', method: 'wrapUp' }]);
    expect(() => assertReporterComplete(state, 1)).toThrow('failed');
  });
  it('observes an asynchronous callback failure independently of upstream logging', async () => {
    const state = createReporterState();
    const reporter = strictReporter({ events: { async onMutantTested() { throw new Error('async write'); }, wrapUp() {} } }, state, 50);
    reporter.onMutantTested({});
    reporter.onMutationTestReportReady(report, metrics);
    await reporter.wrapUp().catch(() => {});
    expect(state.failures[0]).toMatchObject({ reporter: 'events', method: 'onMutantTested' });
    expect(() => assertReporterComplete(state, 1)).toThrow();
  });
  it('requires expected lifecycle calls, not just an empty error marker', async () => {
    const state = createReporterState();
    const reporter = strictReporter({ events: { onDryRunCompleted() {}, onMutantTested() {}, wrapUp() {} } }, state, 50);
    reporter.onMutationTestReportReady(report, metrics);
    await reporter.wrapUp();
    expect(() => assertReporterComplete(state, 1)).toThrow('callback');
  });
  it('agrees with upstream division-before-multiplication for the1/3 metric', async () => {
    const state = createReporterState();
    const reporter = strictReporter({ json: { onMutationTestReportReady() {}, wrapUp() {} } }, state, 50);
    const third = { thresholds: { break: 50 }, files: { source: { mutants: [{ status: 'Killed' }, { status: 'Survived' }, { status: 'NoCoverage' }] } } };
    const upstreamMetric = (1 / 3) * 100;
    expect(upstreamMetric).not.toBe(100 * 1 / 3);
    reporter.onMutationTestReportReady(third, { systemUnderTestMetrics: { metrics: { mutationScore: upstreamMetric } } });
    await reporter.wrapUp();
    assertReporterComplete(state, 3);
    expect(state.decision.score).toBe(upstreamMetric);
  });
});
