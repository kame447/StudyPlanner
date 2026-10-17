import type { CandidateChoiceRequest, CalibratedChoicePolicy, CandidateBasis, CandidateTuple } from '../application/candidateSelection/contracts';
import { buildCandidateHierarchy } from '../application/candidateSelection/hierarchy';
import { gateCandidateChoice } from '../application/candidateSelection/gate';
import { createCandidateManifest } from '../application/candidateSelection/manifest';
import type { CandidateSemanticGatePolicy } from '../../../services/ai/candidateChoiceClient';
import { createReplyReferenceSnapshotV5, resolveReplyReferenceCandidateV5,
  type ReplyReferenceCandidateV5 } from './weeklyPlanningReplyReferenceCandidatesV5';

type ReferenceSource = Parameters<typeof createReplyReferenceSnapshotV5>[0];

export interface ReplyReferenceChoicePortV5 {
  choose(request: CandidateChoiceRequest, beforeDispatch: () => void): Promise<unknown>;
}

/**
 * Independent, explicitly calibrated policy: existing C5/D5 evidence cannot authorize this route.
 * The returned selection is a read-only hint, never a Fact Graph mutation.
 */
export interface ReplyReferenceChoiceCalibrationV5 {
  readonly policy: CalibratedChoicePolicy;
  readonly semanticPolicy: CandidateSemanticGatePolicy;
  readonly maximumChildrenPerMenu: number;
}
export const WEEKLY_PLANNING_REPLY_REFERENCE_CALIBRATION_V5: ReplyReferenceChoiceCalibrationV5 | null = null;
export function readReplyReferenceCalibrationV5(): ReplyReferenceChoiceCalibrationV5 | null {
  return WEEKLY_PLANNING_REPLY_REFERENCE_CALIBRATION_V5;
}

export async function selectReplyReferenceHintV5(params: {
  readonly source: ReferenceSource;
  readonly readCurrent: () => ReferenceSource;
  readonly userText: string;
  readonly ownerId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly calibration: ReplyReferenceChoiceCalibrationV5 | null;
  readonly port: ReplyReferenceChoicePortV5;
}): Promise<ReplyReferenceCandidateV5 | null> {
  if (!params.calibration || !params.userText.trim() || !params.requestId.trim()
    || !params.ownerId.trim() || !params.conversationId.trim()) return null;
  const frozen = createReplyReferenceSnapshotV5(params.source);
  const latest = params.source.messages[params.source.messages.length - 1];
  if (!frozen || !latest || frozen.planningStateRevision + 1 > Number.MAX_SAFE_INTEGER) return null;
  const candidates: CandidateBasis<CandidateTuple>['candidates'] = frozen.candidates.map(candidate => {
    const messageOrdinal = frozen.conversationMessageIds.indexOf(candidate.sourceMessageId) + 1;
    return {
      id: candidate.key,
      label: '発話' + messageOrdinal + ' / ' + candidate.label + ' / ' +
        (params.source.messages.find(message => message.id === candidate.sourceMessageId)?.content.slice(0, 120) ?? ''),
      // The provider sees descriptions and opaque option keys, not canonical Fact IDs or owner IDs.
      tuple: { messageOrdinal, targetKind: candidate.targetKind, slot: candidate.slot,
        operation: candidate.operation, path: [...candidate.componentPath] },
    };
  });
  let manifest: Awaited<ReturnType<typeof createCandidateManifest>>;
  let request: CandidateChoiceRequest;
  try {
    manifest = await createCandidateManifest({
      binding: {
        ownerId: params.ownerId, conversationId: params.conversationId, requestId: params.requestId,
        inputRevision: frozen.planningStateRevision, graphRevision: frozen.graphRevision,
        sources: [], target: { kind: 'reply_reference', id: 'current_conversation' },
        scope: { referenceKind: 'existing_fact', selectionKind: 'target_slot_only' },
        question: { id: 'reference:' + params.requestId, code: 'reply_reference_target',
          presentingTurnId: latest.id, presentingMessageId: latest.id,
          presentationRevision: frozen.planningStateRevision },
        selectionEpoch: frozen.planningStateRevision + 1,
      },
      candidates,
    });
    const hierarchy = buildCandidateHierarchy(manifest, params.calibration.maximumChildrenPerMenu);
    // No partial reference may be committed from a group selection.
    if (hierarchy.children.length > 0) return null;
    request = {
      wholeUtterance: params.userText, requestId: params.requestId,
      selectionEpoch: manifest.binding.selectionEpoch, candidateSetHash: manifest.candidateSetHash,
      context: { question: { id: manifest.binding.question.id, code: 'reply_reference_target' },
        target: manifest.binding.target, scope: manifest.binding.scope },
      menu: hierarchy.menu,
    };
  } catch { return null; }
  const current = () => {
    try {
      const observed = createReplyReferenceSnapshotV5(params.readCurrent());
      return observed !== null && JSON.stringify(observed) === JSON.stringify(frozen);
    } catch { return false; }
  };
  if (!current()) return null;
  let checked = false;
  let response: unknown;
  try {
    response = await params.port.choose(request, () => {
      if (checked || !current()) throw new Error('Stale reply reference.');
      checked = true;
    });
  } catch { return null; }
  if (!checked || !current()) return null;
  const gated = gateCandidateChoice({ request, response, policy: params.calibration.policy });
  if (gated.status !== 'selected') return null;
  const selected = request.menu.options.find(option => option.id === gated.optionId);
  if (!selected || selected.kind !== 'leaf') return null;
  return resolveReplyReferenceCandidateV5(frozen, selected.candidate.id, params.readCurrent());
}
