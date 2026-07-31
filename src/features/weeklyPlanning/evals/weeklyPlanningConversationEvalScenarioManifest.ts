export type WeeklyPlanningConversationEvalCapability =
  | 'natural_multiturn'
  | 'paraphrase_generalization'
  | 'non_study_task'
  | 'explicit_repair'
  | 'target_preservation'
  | 'cross_task_correction'
  | 'preview_correction'
  | 'stale_preview_rejection'
  | 'approval_persistence'
  | 'duplicate_approval_suppression';

export interface WeeklyPlanningConversationEvalScenarioManifest {
  id: string;
  description: string;
  capabilities: readonly WeeklyPlanningConversationEvalCapability[];
  fixedUserUtterances: readonly string[];
  requiredUserUtterancesInOrder: readonly string[];
  requiredChecks: readonly string[];
}

export const REQUIRED_WEEKLY_PLANNING_CONVERSATION_EVAL_CAPABILITIES = [
  'natural_multiturn',
  'paraphrase_generalization',
  'non_study_task',
  'explicit_repair',
  'target_preservation',
  'cross_task_correction',
  'preview_correction',
  'stale_preview_rejection',
  'approval_persistence',
  'duplicate_approval_suppression',
] as const satisfies readonly WeeklyPlanningConversationEvalCapability[];

export const WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS = [
  {
    id: 'tomorrow-natural-multiturn',
    description: '明日の計画を自然な複数ターンで作り、既存予定を避けて保存する。',
    capabilities: [
      'natural_multiturn',
      'paraphrase_generalization',
      'approval_persistence',
      'duplicate_approval_suppression',
    ],
    fixedUserUtterances: [
      '次の日の勉強計画を立てたいです',
      '英語を2時間やりたいです',
      '合計で2時間です',
      'この条件で予定を作って',
    ],
    requiredUserUtterancesInOrder: [
      '次の日の勉強計画を立てたいです',
    ],
    requiredChecks: [
      'multiTurn',
      'noFailure',
      'traceCaptured',
      'tomorrowResolved',
      'workloadPreserved',
      'existingPlanAvoided',
      'saved',
      'duplicateApprovalSuppressed',
    ],
  },
  {
    id: 'next-week-non-study-paraphrase',
    description: '別表現と非学習タスクでも同じ会話構造でpreviewと保存まで進む。',
    capabilities: [
      'natural_multiturn',
      'paraphrase_generalization',
      'non_study_task',
      'approval_persistence',
    ],
    fixedUserUtterances: [
      '来週のやることをいい感じに組みたいです',
      '部屋の掃除を1時間入れたいです',
      '全部で1時間です',
      'この条件で予定を作って',
    ],
    requiredUserUtterancesInOrder: [
      '来週のやることをいい感じに組みたいです',
    ],
    requiredChecks: [
      'multiTurn',
      'noFailure',
      'nextWeekResolved',
      'workloadPreserved',
      'nonStudyTypePreserved',
      'saved',
    ],
  },
  {
    id: 'wrong-unit-explicit-repair',
    description: '所要時間質問へ誤った単位で答えた後、聞き返しと明示的修復で復帰する。',
    capabilities: [
      'explicit_repair',
      'target_preservation',
      'approval_persistence',
    ],
    fixedUserUtterances: [
      '来週、数学の問題を40問進める予定を立てたいです',
      '3ページです',
      '違います。ページ数ではなく、数学40問の所要時間は合計3時間です',
      'この条件で予定を作って',
    ],
    requiredUserUtterancesInOrder: [
      '来週、数学の問題を40問進める予定を立てたいです',
      '3ページです',
      '違います。ページ数ではなく、数学40問の所要時間は合計3時間です',
    ],
    requiredChecks: [
      'wrongAnswerDidNotCreatePreview',
      'wrongAnswerTurnRecorded',
      'questionCodePreserved',
      'targetFactPreserved',
      'noSpuriousTaskCreated',
      'repairedRevisionAdvanced',
      'repairedPreviewCreated',
      'repairedTotalApplied',
      'saved',
    ],
  },
  {
    id: 'cross-task-correction-before-preview',
    description: '複数タスクの所要時間訂正で対象を取り違えず、訂正後のpreviewを作る。',
    capabilities: [
      'cross_task_correction',
      'target_preservation',
      'approval_persistence',
    ],
    fixedUserUtterances: [
      '来週、英語を2時間、数学を3時間やりたいです',
      '訂正です。英語は3時間、数学は2時間です',
      '修正後の条件で予定を作って',
    ],
    requiredUserUtterancesInOrder: [
      '来週、英語を2時間、数学を3時間やりたいです',
      '訂正です。英語は3時間、数学は2時間です',
    ],
    requiredChecks: [
      'twoActiveTasksRemain',
      'totalPreserved',
      'englishCorrected',
      'mathCorrected',
      'noDuplicateTask',
      'saved',
    ],
  },
  {
    id: 'preview-correction-recompute',
    description: 'preview表示後に条件を訂正し、旧previewを無効化して再preview・保存する。',
    capabilities: [
      'preview_correction',
      'stale_preview_rejection',
      'approval_persistence',
      'duplicate_approval_suppression',
    ],
    fixedUserUtterances: [
      '来週、英語を2時間、数学を3時間やる予定を作ってください',
      '訂正です。数学は3時間ではなく1時間にしてください',
      '修正後の条件で予定を作って',
    ],
    requiredUserUtterancesInOrder: [
      '来週、英語を2時間、数学を3時間やる予定を作ってください',
      '訂正です。数学は3時間ではなく1時間にしてください',
    ],
    requiredChecks: [
      'oldPreviewExisted',
      'correctionClearedPreview',
      'graphRevisionAdvanced',
      'correctedPreviewCreated',
      'correctedTotalApplied',
      'previewIdentityChanged',
      'stalePreviewRejected',
      'englishPreserved',
      'mathCorrected',
      'saved',
      'duplicateApprovalSuppressed',
    ],
  },
] as const satisfies readonly WeeklyPlanningConversationEvalScenarioManifest[];

function uniqueNonEmptyValues(
  values: readonly string[],
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) {
      errors.push(`${label} contains an empty value`);
      continue;
    }
    if (seen.has(value)) errors.push(`${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

export function validateWeeklyPlanningConversationEvalScenarioManifests(
  manifests: readonly WeeklyPlanningConversationEvalScenarioManifest[],
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const initialUtterances = new Set<string>();
  const coveredCapabilities = new Set<WeeklyPlanningConversationEvalCapability>();

  for (const manifest of manifests) {
    const id = manifest.id.trim();
    if (!id) errors.push('scenario id must not be empty');
    if (ids.has(id)) errors.push(`duplicate scenario id: ${id}`);
    ids.add(id);

    if (!manifest.description.trim()) {
      errors.push(`${id}: description must not be empty`);
    }
    if (manifest.fixedUserUtterances.length === 0) {
      errors.push(`${id}: fixedUserUtterances must not be empty`);
      continue;
    }
    uniqueNonEmptyValues(
      manifest.fixedUserUtterances,
      `${id}: fixedUserUtterances`,
      errors,
    );
    uniqueNonEmptyValues(
      manifest.requiredUserUtterancesInOrder,
      `${id}: requiredUserUtterancesInOrder`,
      errors,
    );
    uniqueNonEmptyValues(manifest.requiredChecks, `${id}: requiredChecks`, errors);

    const fixed = new Set(manifest.fixedUserUtterances.map((utterance) => utterance.trim()));
    manifest.requiredUserUtterancesInOrder.forEach((utterance) => {
      if (!fixed.has(utterance.trim())) {
        errors.push(`${id}: required utterance is not in fixedUserUtterances: ${utterance}`);
      }
    });
    if (manifest.requiredChecks.length === 0) {
      errors.push(`${id}: requiredChecks must not be empty`);
    }

    const initialUtterance = manifest.fixedUserUtterances[0].trim();
    if (initialUtterances.has(initialUtterance)) {
      errors.push(`${id}: duplicate initial utterance: ${initialUtterance}`);
    }
    initialUtterances.add(initialUtterance);

    manifest.capabilities.forEach((capability) => coveredCapabilities.add(capability));
  }

  for (const capability of REQUIRED_WEEKLY_PLANNING_CONVERSATION_EVAL_CAPABILITIES) {
    if (!coveredCapabilities.has(capability)) {
      errors.push(`missing required capability: ${capability}`);
    }
  }

  return errors;
}

export function validateWeeklyPlanningConversationEvalScenarioExecution(params: {
  manifest: WeeklyPlanningConversationEvalScenarioManifest;
  actualUserUtterances: readonly string[];
  checks: Readonly<Record<string, boolean>>;
}): string[] {
  const errors: string[] = [];
  let cursor = 0;
  for (const required of params.manifest.requiredUserUtterancesInOrder) {
    const foundIndex = params.actualUserUtterances.findIndex(
      (utterance, index) => index >= cursor && utterance.trim() === required.trim(),
    );
    if (foundIndex < 0) {
      errors.push(`${params.manifest.id}: required utterance was not executed: ${required}`);
      continue;
    }
    cursor = foundIndex + 1;
  }

  for (const check of params.manifest.requiredChecks) {
    if (!Object.prototype.hasOwnProperty.call(params.checks, check)) {
      errors.push(`${params.manifest.id}: required check was not recorded: ${check}`);
    } else if (params.checks[check] !== true) {
      errors.push(`${params.manifest.id}: required check failed: ${check}`);
    }
  }
  return errors;
}

export function selectWeeklyPlanningConversationEvalScenarioManifests(
  manifests: readonly WeeklyPlanningConversationEvalScenarioManifest[],
  requestedScenario: string | undefined,
): readonly WeeklyPlanningConversationEvalScenarioManifest[] {
  const normalized = requestedScenario?.trim();
  if (!normalized || normalized === 'all') return manifests;
  const selected = manifests.filter((manifest) => manifest.id === normalized);
  if (selected.length !== 1) {
    throw new Error(`Unknown weekly planning conversation eval scenario: ${normalized}`);
  }
  return selected;
}
