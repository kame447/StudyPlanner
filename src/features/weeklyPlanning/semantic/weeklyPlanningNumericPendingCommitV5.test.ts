import { describe, expect, it } from 'vitest';
import { createSelectionLedger, prepareCandidateSelectionCommit } from '../application/candidateSelection';
import { numericFixture } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { tryNumericPendingChoiceRouteV5 } from './weeklyPlanningNumericPendingChoiceV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { commitNumericPendingChoiceV5, createNumericPendingControlledAdapterV5, prepareNumericPendingCommitV5, type NumericPendingAtomicViewV5, type NumericPendingReducerBridgeV5 } from './weeklyPlanningNumericPendingCommitV5';
async function fixture() {
  const h = numericFixture();
  const staged = await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => '' }, h.input), h.port);
  if (!staged) throw new Error('Expected synthetic staged result');
  const view: NumericPendingAtomicViewV5 = { input: h.input, state: h.state, domainMinutes: h.port.domainMinutes, domainPolicyVersion: h.port.domainPolicyVersion, ledger: createSelectionLedger('owner-1', 'conversation-numeric'), turnId: 'turn-numeric' };
  return { h, staged, view };
}
describe('D5 controlled-commit adapter contract (test double, production integration HOLD)', () => {
  it.each(['domain', 'policyVersion', 'questionEpoch', 'presentation', 'graph', 'permission'] as const)('rejects %s drift after selection and an awaited handoff', async kind => {
    const { staged, view } = await fixture(); await Promise.resolve();
    const next = { ...view };
    if (kind === 'domain') next.domainMinutes = [10, 30];
    if (kind === 'policyVersion') next.domainPolicyVersion = 'v2';
    if (kind === 'questionEpoch') next.state = { ...view.state, binding: { ...view.state.binding, selectionEpoch: 4 } };
    if (kind === 'presentation') next.state = { ...view.state, binding: { ...view.state.binding, question: { ...view.state.binding.question, presentingMessageId: 're-presented' } } };
    if (kind === 'graph') next.input = { ...view.input, committedGraph: { ...view.input.committedGraph!, revision: 3 } };
    if (kind === 'permission') next.state = { ...view.state, sourceAccess: 'denied' };
    expect(prepareNumericPendingCommitV5(staged, next).status).toBe('rejected');
    expect(view.ledger.consumed).toHaveLength(0); expect(view.input.committedGraph!.effortEstimates).toHaveLength(0);
  });
  it('atomically consumes proof once in a reference port; retry cannot repeat mutation', async () => {
    const { staged, view } = await fixture(); let current = view; let writes = 0;
    const port = { async commitAtomically(_staged: typeof staged, decide: (v: NumericPendingAtomicViewV5) => ReturnType<typeof prepareNumericPendingCommitV5>) {
      const decision = decide(current); if (decision.status !== 'prepared') return decision;
      current = { ...current, ledger: decision.nextLedger, input: { ...current.input, committedGraph: decision.graph } }; writes++;
      return { status: 'committed' as const };
    } };
    expect(await commitNumericPendingChoiceV5(staged, port)).toEqual({ status: 'committed' });
    expect((await commitNumericPendingChoiceV5(staged, port)).status).toBe('rejected'); expect(writes).toBe(1);
    expect(current.ledger.consumed[0].candidateSetHash).toBe(staged.selection.manifest.candidateSetHash);
  });
  it('retains unknown commit outcome rather than retry/fallback; rejects forged/tampered document', async () => {
    const { staged, view } = await fixture();
    expect(await commitNumericPendingChoiceV5(staged, { commitAtomically: async () => { throw new Error('could have committed'); } })).toEqual({ status: 'unknown' });
    const changed = structuredClone(staged.document); changed.tasks[0].effortEstimates[0].precision = 'approximate';
    expect(prepareNumericPendingCommitV5({ ...staged, document: changed }, view).status).toBe('rejected');
  });
  it('matches D controlled consumer shape, retains staged capability, and obtains its receipt from the injected factory', async () => {
    const { staged, view } = await fixture();
    const ledger = { ...view.ledger, version: 1 as const, lastEpoch: staged.selection.manifest.binding.selectionEpoch };
    const current = { ...view, current: { revision: 3, intakeState: { c5SelectionLedger: ledger } }, ledger };
    let runtimeGraph = view.input.committedGraph!; let guard: () => boolean = () => false;
    const issuedReceipt = Object.freeze({ opaqueTestReceipt: true }); let issues = 0;
    const bridge: NumericPendingReducerBridgeV5<typeof current.current, typeof issuedReceipt> = {
      readCurrent: () => current, readRuntimeGraph: () => runtimeGraph,
      prepareLocalCandidateReducerCommit(input) {
        expect(input.selection).toBe(staged.selection); expect(input.current).toBe(current.current);
        expect(prepareCandidateSelectionCommit(input.selection, input.view).status).toBe('prepared');
        guard = input.revalidateFinalized; issues++; return issuedReceipt;
      },
    };
    const adapter = createNumericPendingControlledAdapterV5(staged, bridge)!;
    expect(adapter.branch).toBe('d5_pending_selection'); expect(adapter.selected.selection).toBe(staged.selection);
    await Promise.resolve(); // Continuation happens before synchronous controller prepare.
    expect(adapter.prepare()).toBe(issuedReceipt); expect(issues).toBe(1); expect(guard()).toBe(false);
    runtimeGraph = adapter.selected.graph; expect(guard()).toBe(true);
    current.current.intakeState.c5SelectionLedger = { ...ledger, lastEpoch: ledger.lastEpoch + 1 }; expect(guard()).toBe(false);
    current.current.intakeState.c5SelectionLedger = ledger;
    current.domainPolicyVersion = 'changed-between-finalize-and-reducer'; expect(guard()).toBe(false);
    expect(adapter.prepare()).toBeNull(); // Already-finalized runtime cannot repeat pre-commit planning.
  });
  it('rejects pending/domain drift across continuation before issuing any D receipt', async () => {
    const { staged, view } = await fixture(); let reads = 0; let issued = 0;
    const ledger = { ...view.ledger, version: 1 as const, lastEpoch: staged.selection.manifest.binding.selectionEpoch };
    const bridge = {
      readCurrent() { reads++; return { ...view, domainMinutes: reads > 1 ? [10, 30] : view.domainMinutes,
        current: { intakeState: { c5SelectionLedger: ledger } }, ledger }; },
      readRuntimeGraph: () => view.input.committedGraph!, prepareLocalCandidateReducerCommit() { issued++; return {}; },
    };
    const adapter = createNumericPendingControlledAdapterV5(staged, bridge)!; await Promise.resolve();
    expect(adapter.prepare()).toBeNull(); expect(issued).toBe(0);
  });
});
