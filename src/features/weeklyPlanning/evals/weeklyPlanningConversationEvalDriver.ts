export interface ConversationEvalMachineQuestion {
  code: string | null;
  targetFactId: string | null;
  actionId: string | null;
}

export interface ConversationEvalStateSnapshot {
  machineQuestion: ConversationEvalMachineQuestion;
  graphRevision: number | null;
  previewCount: number;
}

export interface ConversationEvalSubmissionSnapshot
  extends ConversationEvalStateSnapshot {
  accepted: boolean;
  turnIndex: number;
  label: string;
  userText: string;
  assistantText: string;
  failureCode: string | null;
}

export interface ConversationEvalAdapter {
  snapshot(): ConversationEvalStateSnapshot;
  submit(
    userText: string,
    label: string,
  ): Promise<ConversationEvalSubmissionSnapshot>;
}

export interface ConversationEvalQuestionContext {
  question: ConversationEvalMachineQuestion;
  state: ConversationEvalStateSnapshot;
  submittedTurns: readonly ConversationEvalSubmissionSnapshot[];
}

export type ConversationEvalQuestionAnswerResolver = (
  context: ConversationEvalQuestionContext,
) => string;

export interface DriveConversationUntilPreviewOptions {
  answerQuestion: ConversationEvalQuestionAnswerResolver;
  authorizationText: string;
  authorizationLabel?: string;
  maxTurns?: number;
}

export interface DriveConversationUntilPreviewResult {
  submittedTurns: ConversationEvalSubmissionSnapshot[];
  finalState: ConversationEvalStateSnapshot;
  authorizationSent: boolean;
}

export function conversationEvalProgressSignature(
  state: ConversationEvalStateSnapshot,
): string {
  return JSON.stringify({
    questionCode: state.machineQuestion.code,
    targetFactId: state.machineQuestion.targetFactId,
    actionId: state.machineQuestion.actionId,
    graphRevision: state.graphRevision,
    previewCount: state.previewCount,
  });
}

function assertUsableText(text: string, source: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error(`${source} returned an empty utterance.`);
  }
  return normalized;
}

export async function driveConversationUntilPreview(
  adapter: ConversationEvalAdapter,
  options: DriveConversationUntilPreviewOptions,
): Promise<DriveConversationUntilPreviewResult> {
  const maxTurns = options.maxTurns ?? 12;
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new Error('maxTurns must be a positive safe integer.');
  }

  const submittedTurns: ConversationEvalSubmissionSnapshot[] = [];
  const seenQuestionStates = new Set<string>();
  let authorizationSent = false;

  while (true) {
    const state = adapter.snapshot();
    if (state.previewCount > 0) {
      return { submittedTurns, finalState: state, authorizationSent };
    }
    if (submittedTurns.length >= maxTurns) {
      throw new Error(`Preview was not created within ${maxTurns} turns.`);
    }

    const question = state.machineQuestion;
    let userText: string;
    let label: string;

    if (question.code) {
      const signature = conversationEvalProgressSignature(state);
      if (seenQuestionStates.has(signature)) {
        throw new Error(`Conversation made no progress: ${signature}`);
      }
      seenQuestionStates.add(signature);
      userText = assertUsableText(
        options.answerQuestion({ question, state, submittedTurns }),
        `answerQuestion(${question.code})`,
      );
      label = `answer:${question.code}`;
    } else if (!authorizationSent) {
      userText = assertUsableText(
        options.authorizationText,
        'authorizationText',
      );
      label = options.authorizationLabel ?? 'authorize-preview';
      authorizationSent = true;
    } else {
      throw new Error(
        'Conversation stopped without a machine question or preview after authorization.',
      );
    }

    const submitted = await adapter.submit(userText, label);
    submittedTurns.push(submitted);
    if (!submitted.accepted) {
      throw new Error(`Turn ${submitted.turnIndex} was rejected by the controller.`);
    }
    if (submitted.failureCode) {
      throw new Error(
        `Turn ${submitted.turnIndex} failed with ${submitted.failureCode}.`,
      );
    }
  }
}

export interface ConversationEvalTranscriptTurn {
  index: number;
  label: string;
  userText: string;
  assistantText: string;
  machineQuestion: ConversationEvalMachineQuestion;
  graphRevision: number | null;
  previewCount: number;
}

export function renderConversationEvalTranscript(params: {
  scenarioId: string;
  description: string;
  status: 'running' | 'passed' | 'failed';
  turns: readonly ConversationEvalTranscriptTurn[];
  checks?: Readonly<Record<string, boolean>>;
  failure?: string | null;
}): string {
  const turnLines = params.turns.flatMap((turn) => [
    `## Turn ${turn.index}: ${turn.label}`,
    '',
    `ユーザー: ${turn.userText}`,
    '',
    `アプリ: ${turn.assistantText}`,
    '',
    [
      'machine:',
      `question=${turn.machineQuestion.code ?? 'none'},`,
      `target=${turn.machineQuestion.targetFactId ?? 'none'},`,
      `graphRevision=${turn.graphRevision ?? 'none'},`,
      `preview=${turn.previewCount}`,
    ].join(' '),
    '',
  ]);
  const checkLines = Object.entries(params.checks ?? {}).map(
    ([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'}: ${name}`,
  );

  return [
    `# ${params.scenarioId}`,
    '',
    params.description,
    '',
    `Status: ${params.status}`,
    '',
    ...turnLines,
    '## Checks',
    '',
    ...(checkLines.length > 0 ? checkLines : ['- No checks recorded.']),
    '',
    '## Failure',
    '',
    params.failure ?? 'none',
    '',
  ].join('\n');
}
