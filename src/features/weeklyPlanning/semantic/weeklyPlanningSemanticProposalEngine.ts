import type { WeeklyPlanningFactDiff, WeeklyPlanningFactGraph } from './weeklyPlanningFactGraph';
import {
  canonicalizeWeeklyPlanningSemanticDocument,
  type WeeklyPlanningSemanticCanonicalizationResult,
} from './weeklyPlanningSemanticCanonicalizer';
import {
  deriveGenericDialoguePolicy,
  type GenericDialoguePolicySnapshot,
} from './weeklyPlanningGenericDialoguePolicy';
import {
  compileGenericPlanningWorkItems,
  type GenericWorkItemCompilationResult,
} from './weeklyPlanningGenericWorkItems';
import type {
  WeeklyPlanningSemanticNormalizer,
  WeeklyPlanningSemanticNormalizerDiagnostics,
} from './weeklyPlanningSemanticNormalizer';

export interface WeeklyPlanningSemanticProposalInput {
  conversationId: string;
  turnId: string;
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticProposalResult {
  status:
    | 'proposed'
    | 'duplicate'
    | 'provider_failure'
    | 'semantic_rejected'
    | 'canonical_rejected';
  baseGraph: WeeklyPlanningFactGraph;
  proposedGraph: WeeklyPlanningFactGraph;
  diff: WeeklyPlanningFactDiff | null;
  compilation: GenericWorkItemCompilationResult | null;
  dialoguePolicy: GenericDialoguePolicySnapshot | null;
  normalizerDiagnostics: WeeklyPlanningSemanticNormalizerDiagnostics;
  canonicalErrors: string[];
  localToFactId: Record<string, string>;
}

function unchangedResult(params: {
  status: Exclude<WeeklyPlanningSemanticProposalResult['status'], 'proposed'>;
  graph: WeeklyPlanningFactGraph;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnostics;
  canonicalErrors?: string[];
}): WeeklyPlanningSemanticProposalResult {
  return {
    status: params.status,
    baseGraph: params.graph,
    proposedGraph: params.graph,
    diff: null,
    compilation: null,
    dialoguePolicy: null,
    normalizerDiagnostics: params.diagnostics,
    canonicalErrors: params.canonicalErrors ?? [],
    localToFactId: {},
  };
}

function statusForCanonicalResult(
  result: WeeklyPlanningSemanticCanonicalizationResult,
): 'duplicate' | 'canonical_rejected' {
  return result.status === 'duplicate' ? 'duplicate' : 'canonical_rejected';
}

export async function proposeWeeklyPlanningSemanticTurn(params: {
  normalizer: WeeklyPlanningSemanticNormalizer;
  graph: WeeklyPlanningFactGraph;
  input: WeeklyPlanningSemanticProposalInput;
}): Promise<WeeklyPlanningSemanticProposalResult> {
  const normalized = await params.normalizer.normalize({
    userText: params.input.userText,
    recentConversation: params.input.recentConversation,
    publicStateSummary: params.input.publicStateSummary,
  });

  if (!normalized.document) {
    return unchangedResult({
      status: normalized.status === 'provider_failure'
        ? 'provider_failure'
        : 'semantic_rejected',
      graph: params.graph,
      diagnostics: normalized.diagnostics,
    });
  }

  const canonical = canonicalizeWeeklyPlanningSemanticDocument({
    graph: params.graph,
    document: normalized.document,
    context: {
      conversationId: params.input.conversationId,
      turnId: params.input.turnId,
      expectedRevision: params.graph.revision,
    },
  });

  if (canonical.status !== 'applied' || !canonical.diff) {
    return unchangedResult({
      status: statusForCanonicalResult(canonical),
      graph: params.graph,
      diagnostics: normalized.diagnostics,
      canonicalErrors: canonical.errors,
    });
  }

  const compilation = compileGenericPlanningWorkItems(canonical.graph);
  const dialoguePolicy = deriveGenericDialoguePolicy({
    graph: canonical.graph,
    diff: canonical.diff,
    compilation,
  });

  return {
    status: 'proposed',
    baseGraph: params.graph,
    proposedGraph: canonical.graph,
    diff: canonical.diff,
    compilation,
    dialoguePolicy,
    normalizerDiagnostics: normalized.diagnostics,
    canonicalErrors: [],
    localToFactId: canonical.localToFactId,
  };
}
