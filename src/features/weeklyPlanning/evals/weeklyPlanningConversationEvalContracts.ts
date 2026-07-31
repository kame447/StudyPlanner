export interface ConversationEvalRepairSnapshot {
  graphRevision: number | null;
  previewCount: number;
  questionCode: string | null;
  targetFactId: string | null;
  activeTaskCount: number;
  totalPreviewMinutes: number;
}

export interface ConversationEvalPreviewSnapshot {
  graphRevision: number | null;
  previewKeys: readonly string[];
  totalPreviewMinutes: number;
}

export interface ConversationEvalRepairContractResult {
  wrongAnswerDidNotCreatePreview: boolean;
  wrongAnswerTurnRecorded: boolean;
  questionCodePreserved: boolean;
  targetFactPreserved: boolean;
  noSpuriousTaskCreated: boolean;
  repairedRevisionAdvanced: boolean;
  repairedPreviewCreated: boolean;
  repairedTotalApplied: boolean;
}

export function evaluateExplicitRepairContract(params: {
  expectedQuestionCode: string;
  expectedTargetFactId: string | null;
  activeTaskCountBeforeWrongAnswer: number;
  expectedRepairedTotalMinutes: number;
  beforeWrongAnswer: ConversationEvalRepairSnapshot;
  afterWrongAnswer: ConversationEvalRepairSnapshot;
  afterRepair: ConversationEvalRepairSnapshot;
}): ConversationEvalRepairContractResult {
  return {
    wrongAnswerDidNotCreatePreview: params.afterWrongAnswer.previewCount === 0,
    wrongAnswerTurnRecorded:
      params.beforeWrongAnswer.graphRevision !== null
      && params.afterWrongAnswer.graphRevision !== null
      && params.afterWrongAnswer.graphRevision
        > params.beforeWrongAnswer.graphRevision,
    questionCodePreserved:
      params.afterWrongAnswer.questionCode === params.expectedQuestionCode,
    targetFactPreserved:
      params.afterWrongAnswer.targetFactId === params.expectedTargetFactId,
    noSpuriousTaskCreated:
      params.afterWrongAnswer.activeTaskCount
        === params.activeTaskCountBeforeWrongAnswer,
    repairedRevisionAdvanced:
      params.afterRepair.graphRevision !== null
      && params.afterWrongAnswer.graphRevision !== null
      && params.afterRepair.graphRevision > params.afterWrongAnswer.graphRevision,
    repairedPreviewCreated: params.afterRepair.previewCount > 0,
    repairedTotalApplied:
      params.afterRepair.totalPreviewMinutes
        === params.expectedRepairedTotalMinutes,
  };
}

export interface ConversationEvalPreviewCorrectionContractResult {
  oldPreviewExisted: boolean;
  correctionClearedPreview: boolean;
  graphRevisionAdvanced: boolean;
  correctedPreviewCreated: boolean;
  correctedTotalApplied: boolean;
  previewIdentityChanged: boolean;
}

function normalizedKeys(keys: readonly string[]): string {
  return [...keys].sort().join('|');
}

export function evaluatePreviewCorrectionContract(params: {
  expectedCorrectedTotalMinutes: number;
  beforeCorrection: ConversationEvalPreviewSnapshot;
  correctionTurn: ConversationEvalPreviewSnapshot;
  afterCorrection: ConversationEvalPreviewSnapshot;
}): ConversationEvalPreviewCorrectionContractResult {
  return {
    oldPreviewExisted: params.beforeCorrection.previewKeys.length > 0,
    correctionClearedPreview: params.correctionTurn.previewKeys.length === 0,
    graphRevisionAdvanced:
      params.beforeCorrection.graphRevision !== null
      && params.afterCorrection.graphRevision !== null
      && params.afterCorrection.graphRevision
        > params.beforeCorrection.graphRevision,
    correctedPreviewCreated: params.afterCorrection.previewKeys.length > 0,
    correctedTotalApplied:
      params.afterCorrection.totalPreviewMinutes
        === params.expectedCorrectedTotalMinutes,
    previewIdentityChanged:
      normalizedKeys(params.beforeCorrection.previewKeys)
        !== normalizedKeys(params.afterCorrection.previewKeys),
  };
}

export function allConversationEvalChecksPass(
  checks: Readonly<Record<string, boolean>>,
): boolean {
  return Object.values(checks).every(Boolean);
}
