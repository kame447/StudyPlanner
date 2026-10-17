import type { CandidateChoiceRequest, CalibratedChoicePolicy, CandidateBasis, CandidateTuple } from '../application/candidateSelection/contracts';
import { buildCandidateHierarchy } from '../application/candidateSelection/hierarchy';
import { gateCandidateChoice } from '../application/candidateSelection/gate';
import { createCandidateManifest } from '../application/candidateSelection/manifest';
import { canonicalCandidateSerialization } from '../application/candidateSelection/canonical';
import { boundReplyReferenceTextV5, buildReplyReferenceSnapshotV5, createReplyReferenceSnapshotV5, resolveReplyReferenceCandidateV5,
  type ReplyReferenceCandidateV5, type ReplyReferenceDiagnosticsV5 } from './weeklyPlanningReplyReferenceCandidatesV5';
import { candidateChoiceAcceptanceScope, isCandidateChoiceDecisionContext } from '../../../../shared/candidateChoiceDecision';

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
  readonly semanticPolicy: {
    readonly calibrationEvidenceId: string;
    readonly maximumConditionChange: number;
    readonly maximumIndependentMeaning: number;
  };
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
  readonly onDiagnostic?: (diagnostic: ReplyReferenceDiagnosticsV5) => void;
}): Promise<ReplyReferenceCandidateV5 | null> {
  if (!params.calibration || !params.userText.trim() || !params.requestId.trim()
    || !params.ownerId.trim() || !params.conversationId.trim()) return null;
  const built = buildReplyReferenceSnapshotV5(params.source);
  params.onDiagnostic?.(built.diagnostics);
  const frozen = built.snapshot;
  const latest = params.source.messages[params.source.messages.length - 1];
  if (!frozen || !latest || frozen.planningStateRevision + 1 > Number.MAX_SAFE_INTEGER) return null;
  const candidates: CandidateBasis<CandidateTuple>['candidates'] = frozen.candidates.map(candidate => {
    const messageOrdinal = frozen.conversationMessageIds.indexOf(candidate.sourceMessageId) + 1;
    return {
      id: candidate.key,
      label: '発話' + messageOrdinal + ' / ' + candidate.label + ' / ' +
        boundReplyReferenceTextV5(params.source.messages.find(message => message.id === candidate.sourceMessageId)?.content ?? '', 120),
      // The provider sees descriptions and opaque option keys, not canonical Fact IDs or owner IDs.
      tuple: { messageOrdinal, targetKind: candidate.targetKind, slot: candidate.slot,
        operation: candidate.operation, path: candidate.componentPath.map(part => boundReplyReferenceTextV5(part, 48)) },
    };
  });
  let manifest: Awaited<ReturnType<typeof createCandidateManifest>>;
  let request: CandidateChoiceRequest;
  try {
    const identityDigest = frozen.pendingQuestionIdentity === null ? null
      : 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(canonicalCandidateSerialization(frozen.pendingQuestionIdentity)))),
      byte => byte.toString(16).padStart(2, '0')).join('');
    manifest = await createCandidateManifest({
      binding: {
        ownerId: params.ownerId, conversationId: params.conversationId, requestId: params.requestId,
        inputRevision: frozen.planningStateRevision, graphRevision: frozen.graphRevision,
        sources: identityDigest === null ? [] : [{ id: 'pending_question', revision: identityDigest }],
        target: { kind: 'reply_reference', id: 'current_conversation' },
        scope: { referenceKind: 'existing_fact', selectionKind: 'target_slot_only',
          pendingQuestion: frozen.pendingQuestion ? {
            messageOrdinal: frozen.pendingQuestion.messageOrdinal,
            questionCode: frozen.pendingQuestion.questionCode,
            candidateKeys: [...frozen.pendingQuestion.candidateKeys],
          } : null,
          dialogueHistory: frozen.dialogueHistory.map(turn => ({
            messageOrdinal: turn.messageOrdinal, role: turn.role, content: turn.content,
          })),
        },
        question: { id: 'reference:' + params.requestId, code: 'reply_reference_target',
          presentingTurnId: latest.id, presentingMessageId: latest.id,
          presentationRevision: frozen.planningStateRevision },
        selectionEpoch: frozen.planningStateRevision + 1,
      },
      candidates,
    });
    const hierarchy = buildCandidateHierarchy(manifest, params.calibration.maximumChildrenPerMenu);
    // No partial reference may be committed from a group selection.
    if (hierarchy.children.length > 0) {
      params.onDiagnostic?.({ ...frozen.diagnostics, reason: 'group_menu' });
      return null;
    }
    request = {
      wholeUtterance: params.userText, requestId: params.requestId,
      selectionEpoch: manifest.binding.selectionEpoch, candidateSetHash: manifest.candidateSetHash,
      context: { question: { id: manifest.binding.question.id, code: 'reply_reference_target' },
        target: manifest.binding.target, scope: manifest.binding.scope },
      menu: hierarchy.menu,
    };
    if (!isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request })) {
      params.onDiagnostic?.({ ...frozen.diagnostics, reason: 'invalid_request' });
      return null;
    }
  } catch {
    params.onDiagnostic?.({ ...frozen.diagnostics, reason: 'invalid_request' });
    return null;
  }
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
  // Single-call heads have a bound referent only for the current pending question.
  // Explicit historical references need a separately calibrated bound second step.
  if (candidateChoiceAcceptanceScope(request, selected.id) !== 'pending_question_answer') return null;
  return resolveReplyReferenceCandidateV5(frozen, selected.candidate.id, params.readCurrent());
}
