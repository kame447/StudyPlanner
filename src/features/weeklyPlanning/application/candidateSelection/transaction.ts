import { canonicalCandidateSerialization, freezeCandidateValue } from './canonical';
import { gateCandidateChoice, hasCalibratedMenu, snapshotCalibratedChoicePolicy } from './gate';
import { buildCandidateHierarchy } from './hierarchy';
import { candidateFreshnessFailure, projectCandidateProviderContext } from './manifest';
import type {
  AtomicSelectionCommitPort, AtomicSelectionView, CalibratedChoicePolicy, CandidateChoiceRequest,
  CandidateManifest, CandidateObservation, CandidateTuple, SelectionCommitDecision,
  SelectionCommitOutcome, SelectionFailure, SelectionLedger, StagedCandidateSelection,
} from './contracts';

const stagedSelections = new WeakSet<object>();

export type CandidateSelectionResult<T extends CandidateTuple = CandidateTuple> =
  | { readonly status: 'staged'; readonly selection: StagedCandidateSelection<T> }
  | { readonly status: 'fallback'; readonly reason: SelectionFailure; readonly wholeUtterance: string };

/**
 * No accepted-state writes. Each route is virtual; only the final application leaf can be staged.
 * readCurrent is synchronous and must re-derive the full live basis, never echo the captured manifest.
 * choose MUST call beforeDispatch after async authentication/preparation and immediately before actual
 * provider exposure. It must not await between that callback and dispatch. Async source authorities
 * need their own authoritative revalidation at this boundary; local readCurrent is not a remote CAS.
 */
export async function selectApplicationCandidate<T extends CandidateTuple>(params: {
  manifest: CandidateManifest<T>;
  wholeUtterance: string;
  policy: CalibratedChoicePolicy;
  maximumChildrenPerMenu: number;
  maximumDecisions: number;
  readCurrent(): CandidateObservation<T>;
  choose(request: CandidateChoiceRequest<T>, beforeDispatch: () => void): Promise<unknown>;
}): Promise<CandidateSelectionResult<T>> {
  const { manifest, wholeUtterance, policy: suppliedPolicy, maximumChildrenPerMenu, maximumDecisions, readCurrent, choose } = params;
  const fallback = (reason: SelectionFailure): CandidateSelectionResult<T> => Object.freeze({ status: 'fallback', reason, wholeUtterance });
  let policy: CalibratedChoicePolicy;
  let node: ReturnType<typeof buildCandidateHierarchy<T>>;
  try {
    policy = snapshotCalibratedChoicePolicy(suppliedPolicy);
    node = buildCandidateHierarchy(manifest, maximumChildrenPerMenu);
  } catch { return fallback('invalid_policy'); }
  if (!Number.isSafeInteger(maximumDecisions) || maximumDecisions < 1) return fallback('budget_exhausted');
  const visited = new Set<string>();
  const context = projectCandidateProviderContext(manifest);
  const freshness = (): SelectionFailure | null => {
    try { return candidateFreshnessFailure(manifest, readCurrent()); }
    catch { return 'observation_error'; }
  };
  for (let count = 0; count < maximumDecisions; count += 1) {
    if (visited.has(node.menu.nodeId)) return fallback('repeated_group');
    visited.add(node.menu.nodeId);
    const before = freshness();
    if (before) return fallback(before);
    const request: CandidateChoiceRequest<T> = Object.freeze({
      wholeUtterance,
      requestId: manifest.binding.requestId,
      selectionEpoch: manifest.binding.selectionEpoch,
      candidateSetHash: manifest.candidateSetHash,
      context,
      menu: node.menu,
    });
    if (!hasCalibratedMenu(request, policy)) return fallback('uncalibrated_menu');
    let response: unknown;
    let dispatchChecked = false;
    let dispatchFailure: SelectionFailure | null = null;
    const beforeDispatch = () => {
      dispatchFailure = dispatchChecked ? 'budget_exhausted' : freshness();
      if (dispatchFailure) throw new Error('Candidate dispatch gate rejected.');
      dispatchChecked = true;
    };
    try { response = await choose(request, beforeDispatch); }
    catch { return fallback(dispatchFailure ?? 'provider_error'); }
    if (dispatchFailure) return fallback(dispatchFailure);
    if (!dispatchChecked) return fallback('invalid_response');
    const after = freshness();
    if (after) return fallback(after);
    let choice: ReturnType<typeof gateCandidateChoice<T>>;
    try { choice = gateCandidateChoice({ request, response, policy }); }
    catch { return fallback('invalid_response'); }
    if (choice.status === 'rejected') return fallback(choice.reason);
    const selected = node.menu.options.find((option) => option.id === choice.optionId);
    if (selected?.kind === 'leaf') {
      const selection = Object.freeze({ manifest, candidate: selected.candidate });
      stagedSelections.add(selection);
      return Object.freeze({ status: 'staged', selection });
    }
    if (selected?.kind !== 'group') return fallback('invalid_response');
    const next = node.children.find((child) => child.menu.nodeId === selected.id);
    if (!next || visited.has(next.menu.nodeId)) return fallback('repeated_group');
    node = next;
  }
  return fallback('budget_exhausted');
}

export function createSelectionLedger(ownerId: string, conversationId: string): SelectionLedger {
  if (typeof ownerId !== 'string' || typeof conversationId !== 'string' || !ownerId || !conversationId) throw new Error('Selection ledger requires owner and conversation.');
  return Object.freeze({ ownerId, conversationId, consumed: Object.freeze([]) });
}

/** PURE decision; use ONLY inside the consumer's atomic commit, never check-then-await-apply. */
export function prepareCandidateSelectionCommit<T extends CandidateTuple>(
  selection: StagedCandidateSelection<T>, view: AtomicSelectionView<T>,
): SelectionCommitDecision<T> {
  const rejected = (reason: SelectionFailure): SelectionCommitDecision<T> => ({ status: 'rejected', reason });
  if (!stagedSelections.has(selection)) return rejected('invalid_selection');
  let freshness: SelectionFailure | null;
  try { freshness = candidateFreshnessFailure(selection.manifest, view.observation); }
  catch { return rejected('observation_error'); }
  if (freshness) return rejected(freshness);
  const { binding } = selection.manifest;
  let ledger: SelectionLedger;
  try { ledger = freezeCandidateValue(view.ledger) as unknown as SelectionLedger; }
  catch { return rejected('ledger_scope'); }
  if (ledger?.ownerId !== binding.ownerId || ledger.conversationId !== binding.conversationId
    || Object.keys(ledger).length !== 3 || !Array.isArray(ledger.consumed)
    || ledger.consumed.some((entry) => !entry || Object.keys(entry).length !== 4
      || ['selectionKey', 'requestKey', 'candidateSetHash', 'candidateId'].some((key) => typeof entry[key as keyof typeof entry] !== 'string' || entry[key as keyof typeof entry].length === 0))) return rejected('ledger_scope');
  const selectionKey = canonicalCandidateSerialization([binding.ownerId, binding.conversationId, binding.question.id, binding.selectionEpoch]);
  const requestKey = canonicalCandidateSerialization([binding.ownerId, binding.conversationId, binding.requestId]);
  if (ledger.consumed.some((entry) => entry.selectionKey === selectionKey || entry.requestKey === requestKey)) return rejected('already_consumed');
  try { if (view.validateLeaf(selection.candidate) !== true) return rejected('invalid_leaf'); }
  catch { return rejected('invalid_leaf'); }
  const receipt = Object.freeze({ selectionKey, requestKey, candidateSetHash: selection.manifest.candidateSetHash, candidateId: selection.candidate.id });
  return Object.freeze({
    status: 'prepared', candidate: selection.candidate,
    nextLedger: Object.freeze({ ownerId: binding.ownerId, conversationId: binding.conversationId, consumed: Object.freeze([...ledger.consumed, receipt]) }),
  });
}

export async function commitStagedCandidateSelection<T extends CandidateTuple>(
  selection: StagedCandidateSelection<T>, port: AtomicSelectionCommitPort<T>,
): Promise<SelectionCommitOutcome> {
  if (!stagedSelections.has(selection)) return { status: 'rejected', reason: 'invalid_selection' };
  try {
    return await port.commitAtomically(selection, (view) => prepareCandidateSelectionCommit(selection, view));
  } catch { return { status: 'unknown' }; }
}
