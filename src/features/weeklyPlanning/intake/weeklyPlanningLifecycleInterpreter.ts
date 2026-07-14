import type {
  InterpreterCorrectionTargetSummary,
  InterpreterPendingAssumptionSummary,
  WeeklyPlanningIntakeInterpreter,
  WeeklyPlanningInterpreterResult,
} from './weeklyPlanningInterpreterTypes';

export interface LifecycleInterpreterOptions {
  interpreter: WeeklyPlanningIntakeInterpreter;
  conversationId: string;
  currentStateRevision: number;
  pendingAssumptions: InterpreterPendingAssumptionSummary[];
  correctionTargets: InterpreterCorrectionTargetSummary[];
}

function normalize(text: string): string {
  return text.normalize('NFKC').trim();
}

function selectedProposal(
  text: string,
  proposals: readonly InterpreterPendingAssumptionSummary[],
): InterpreterPendingAssumptionSummary | null {
  if (proposals.length === 1) return proposals[0];
  const referenced = proposals.filter((proposal) =>
    text.includes(proposal.proposalId)
    || text.includes(proposal.targetRef)
    || text.includes(String(proposal.proposedValue)),
  );
  return referenced.length === 1 ? referenced[0] : null;
}

function parseReplacementDuration(text: string): { value: number; unit: 'minutes' | 'hours' } | null {
  const hour = /(?:^|\D)(\d+(?:\.\d+)?)\s*時間/.exec(text);
  if (hour) return { value: Number(hour[1]), unit: 'hours' };
  const minute = /(?:^|\D)(\d+)\s*分/.exec(text);
  if (minute) return { value: Number(minute[1]), unit: 'minutes' };
  return null;
}

function parseAssumptionDecisions(params: {
  text: string;
  proposals: readonly InterpreterPendingAssumptionSummary[];
  currentStateRevision: number;
}): unknown[] {
  const proposal = selectedProposal(params.text, params.proposals);
  if (!proposal) return [];
  const replacement = parseReplacementDuration(params.text);
  if (replacement && /(?:にして|へ変更|に変えて|なら|で進め)/.test(params.text)) {
    return [{
      type: 'modify_assumption',
      proposalId: proposal.proposalId,
      expectedStateRevision: params.currentStateRevision,
      replacementValue: replacement.value,
      replacementUnit: replacement.unit,
      sourceText: params.text,
      confidence: 'high',
    }];
  }
  if (/(?:その仮定|その時間|それ|この案).*(?:進めて|使って|大丈夫|OK|オーケー)|^(?:はい|お願いします|それで)$/.test(params.text)) {
    return [{
      type: 'accept_assumption',
      proposalId: proposal.proposalId,
      expectedStateRevision: params.currentStateRevision,
      sourceText: params.text,
      confidence: 'high',
    }];
  }
  if (/(?:長すぎ|短すぎ|違う|使わない|却下|やめて|その仮定はなし)/.test(params.text)) {
    return [{
      type: 'reject_assumption',
      proposalId: proposal.proposalId,
      expectedStateRevision: params.currentStateRevision,
      sourceText: params.text,
      confidence: 'high',
    }];
  }
  return [];
}

function taskTarget(
  text: string,
  targets: readonly InterpreterCorrectionTargetSummary[],
): InterpreterCorrectionTargetSummary | null {
  const matches = targets.filter((target) => target.kind === 'task' && text.includes(target.label));
  return matches.length === 1 ? matches[0] : null;
}

function correctionId(conversationId: string, revision: number, suffix: string): string {
  return `${conversationId}:correction:${revision}:${suffix}`;
}

function parseCorrectionEnvelopes(params: {
  text: string;
  targets: readonly InterpreterCorrectionTargetSummary[];
  conversationId: string;
  currentStateRevision: number;
}): unknown[] {
  const target = taskTarget(params.text, params.targets);
  if (!target) return [];
  if (/(?:外して|削除して|なしにして|やめる)/.test(params.text)) {
    return [{
      correctionId: correctionId(params.conversationId, params.currentStateRevision, target.ref),
      conversationId: params.conversationId,
      expectedStateRevision: params.currentStateRevision,
      operation: 'remove',
      target: { kind: 'task', taskRef: target.ref },
      sourceText: params.text,
    }];
  }
  const replacement = parseReplacementDuration(params.text);
  if (replacement && /(?:にして|へ変更|に変えて)/.test(params.text)) {
    return [{
      correctionId: correctionId(params.conversationId, params.currentStateRevision, target.ref),
      conversationId: params.conversationId,
      expectedStateRevision: params.currentStateRevision,
      operation: 'replace',
      target: { kind: 'task', taskRef: target.ref },
      replacementCommand: {
        type: 'set_study_goal',
        goal: {
          title: target.label,
          unit: replacement.unit,
          amount: replacement.value,
        },
        sourceText: params.text,
        confidence: 'high',
      },
      sourceText: params.text,
    }];
  }
  return [];
}

export function createLifecycleAwareWeeklyPlanningInterpreter(
  options: LifecycleInterpreterOptions,
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn(params): Promise<WeeklyPlanningInterpreterResult> {
      const stateSummary = {
        ...params.stateSummary,
        pendingAssumptionProposals: options.pendingAssumptions.map((proposal) => ({ ...proposal })),
        correctionTargets: options.correctionTargets.map((target) => ({ ...target })),
      };
      const base = await options.interpreter.interpretUserTurn({ ...params, stateSummary });
      const text = normalize(params.userText);
      const assumptionDecisions = [
        ...(base.assumptionDecisions ?? []),
        ...parseAssumptionDecisions({
          text,
          proposals: options.pendingAssumptions,
          currentStateRevision: options.currentStateRevision,
        }),
      ];
      const correctionEnvelopes = [
        ...(base.correctionEnvelopes ?? []),
        ...parseCorrectionEnvelopes({
          text,
          targets: options.correctionTargets,
          conversationId: options.conversationId,
          currentStateRevision: options.currentStateRevision,
        }),
      ];
      return {
        ...base,
        ...(assumptionDecisions.length > 0 ? { assumptionDecisions } : {}),
        ...(correctionEnvelopes.length > 0 ? { correctionEnvelopes } : {}),
      };
    },
  };
}
