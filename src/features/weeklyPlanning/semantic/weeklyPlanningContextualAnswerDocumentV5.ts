import {
  SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskCategoryV5,
  type SemanticTaskV5,
  type SemanticWorkloadUnitCodeV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  groundedDurationMinutesFromUserTextV5,
  groundedQuantityRoleFromUserTextV5,
  hasWeeklyPlanningContextualScopeChangeCueV5,
  type WeeklyPlanningGroundedQuantityRoleV5,
} from './weeklyPlanningContextualAnswerGroundingV5';
import {
  isWeeklyPlanningContextualQuestionCodeV5,
  readWeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';

export interface GroundedContextualAnswerDocumentResultV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

interface PublicTaskV5 {
  publicId: string;
  category: SemanticTaskCategoryV5;
  title: string;
}

interface PublicWorkloadV5 {
  publicId: string;
  taskPublicId: string;
  componentPublicId: string | null;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
}

interface PublicComponentV5 {
  publicId: string;
  taskPublicId: string;
  parentComponentPublicId: string | null;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function taskCategory(value: unknown): SemanticTaskCategoryV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_TASK_CATEGORIES_V5 as readonly string[]).includes(value)
    ? value as SemanticTaskCategoryV5
    : null;
}

function workloadUnit(value: unknown): SemanticWorkloadUnitCodeV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_WORKLOAD_UNIT_CODES_V5 as readonly string[]).includes(value)
    ? value as SemanticWorkloadUnitCodeV5
    : null;
}

function readPublicTask(
  publicStateSummary: Record<string, unknown>,
  publicId: string,
): PublicTaskV5 | null {
  const value = records(publicStateSummary.tasks)
    .find((candidate) => candidate.publicId === publicId);
  if (!value) return null;
  const category = taskCategory(value.category);
  if (category === null || typeof value.title !== 'string' || !value.title.trim()) {
    return null;
  }
  return { publicId, category, title: value.title.trim() };
}

function readTargetWorkload(
  publicStateSummary: Record<string, unknown>,
  publicId: string,
): PublicWorkloadV5 | null {
  const value = records(publicStateSummary.workloads)
    .find((candidate) => candidate.publicId === publicId);
  if (!value) return null;
  const unitCode = workloadUnit(value.unitCode);
  if (
    typeof value.taskPublicId !== 'string'
    || !value.taskPublicId
    || typeof value.amount !== 'number'
    || !Number.isFinite(value.amount)
    || value.amount <= 0
    || unitCode === null
    || typeof value.unitLabel !== 'string'
    || !value.unitLabel.trim()
  ) {
    return null;
  }
  return {
    publicId,
    taskPublicId: value.taskPublicId,
    componentPublicId: typeof value.componentPublicId === 'string'
      ? value.componentPublicId
      : null,
    amount: value.amount,
    unitCode,
    unitLabel: value.unitLabel.trim(),
  };
}

function readComponents(
  publicStateSummary: Record<string, unknown>,
  taskPublicId: string,
): PublicComponentV5[] {
  return records(publicStateSummary.components).flatMap((value) => {
    if (
      typeof value.publicId !== 'string'
      || value.taskPublicId !== taskPublicId
      || typeof value.label !== 'string'
      || !value.label.trim()
    ) {
      return [];
    }
    return [{
      publicId: value.publicId,
      taskPublicId,
      parentComponentPublicId: typeof value.parentComponentPublicId === 'string'
        ? value.parentComponentPublicId
        : null,
      label: value.label.trim(),
    }];
  });
}

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function taskShell(task: PublicTaskV5, sourceText: string): SemanticTaskV5 {
  return {
    localId: 'contextual-task',
    category: task.category,
    title: task.title,
    study: task.category === 'study'
      ? {
          purpose: 'unknown',
          contextLabel: null,
          components: [],
        }
      : null,
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText,
  };
}

function targetDurationMinutes(workload: PublicWorkloadV5): number | null {
  if (workload.unitCode === 'hour') return workload.amount * 60;
  if (workload.unitCode === 'minute') return workload.amount;
  return null;
}

function explicitDurationMatchesTarget(
  userText: string,
  workload: PublicWorkloadV5,
): boolean {
  const durations = groundedDurationMinutesFromUserTextV5(userText);
  if (durations.length === 0) return true;
  const expected = targetDurationMinutes(workload);
  return expected !== null
    && durations.length === 1
    && Math.round(expected) === durations[0];
}

function normalizedAnswerText(userText: string): string {
  return userText
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[、，。.!！?？]/g, '');
}

function quantityRoleOnlyReply(
  userText: string,
  role: WeeklyPlanningGroundedQuantityRoleV5,
): boolean {
  const text = normalizedAnswerText(userText)
    .replace(/^(?:はい|ええ|うん|そうです|そうですね)/, '')
    .replace(/\d+(?:\.\d+)?時間(?:(?:半)|(?:\d+(?:\.\d+)?)分)?/g, '')
    .replace(/\d+(?:\.\d+)?分/g, '')
    .replace(/^(?:それ|これ)(?:が|は)/, '')
    .replace(/^(?:が|は)/, '');
  const ending = '(?:です|だ|になります|にします)?';

  if (role === 'target') {
    return new RegExp(
      `^(?:今回(?:の|に|で)?(?:進めたい|やりたい|取り組みたい|行いたい|実施したい)?(?:分|量)?|この(?:計画|予定|期間)(?:に|で|の)?(?:進めたい|やりたい|取り組みたい|行いたい|実施したい)?(?:分|量)?|目標量?|今回分)${ending}$`,
    ).test(text);
  }
  if (role === 'remaining') {
    return new RegExp(
      `^(?:残り(?:の)?(?:全体)?(?:分|量)?|残量|残っている(?:全体)?(?:分|量)?|全体量|未完了(?:分|量)?|未消化(?:分|量)?)${ending}$`,
    ).test(text);
  }
  return new RegExp(
    `^(?:完了(?:済み)?(?:分|量)?|済んだ(?:分|量)?|終わった(?:分|量)?|やり終えた(?:分|量)?|進め終えた(?:分|量)?|実施済み(?:分|量)?|消化済み(?:分|量)?)${ending}$`,
  ).test(text);
}

function durationOnlyReply(userText: string): boolean {
  const text = normalizedAnswerText(userText);
  return /^(?:(?:約|およそ|だいたい))?\d+(?:\.\d+)?時間(?:(?:半)|(?:\d+(?:\.\d+)?)分)?(?:(?:くらい|ぐらい|ほど))?(?:です|だ|かかります|かかると思います|だと思います)?$/.test(text)
    || /^(?:(?:約|およそ|だいたい))?\d+(?:\.\d+)?分(?:(?:くらい|ぐらい|ほど))?(?:です|だ|かかります|かかると思います|だと思います)?$/.test(text);
}

function hasCorrectionCue(userText: string): boolean {
  return /(?:違います|違う|訂正|修正|間違|誤り|ではなく|じゃなく)/.test(
    normalizedAnswerText(userText),
  );
}

function hasSchedulingFactCue(userText: string): boolean {
  const text = userText.normalize('NFKC');
  return /(?:今日|明日|明後日|今週|来週|再来週|月曜|火曜|水曜|木曜|金曜|土曜|日曜|午前|午後|朝|昼|夕方|夜|寝る前|食事前|食事後)/.test(text)
    || /\d{1,2}\s*時(?!間)/.test(text)
    || /\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text);
}

function targetComponentLabels(
  components: PublicComponentV5[],
  componentPublicId: string | null,
): string[] {
  if (!componentPublicId) return [];
  const byId = new Map(components.map((component) => [component.publicId, component]));
  const labels: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(componentPublicId);
  while (current && !visited.has(current.publicId)) {
    visited.add(current.publicId);
    labels.push(current.label);
    current = current.parentComponentPublicId
      ? byId.get(current.parentComponentPublicId)
      : undefined;
  }
  return labels;
}

function normalizedIdentityCandidates(
  task: PublicTaskV5,
  components: PublicComponentV5[],
  workload: PublicWorkloadV5,
): string[] {
  const taskCore = task.title
    .normalize('NFKC')
    .replace(/(?:の)?(?:問題|課題|学習|勉強|作業|執筆|確認|練習|復習|準備|対応|処理)?(?:を)?(?:進める|やる|取り組む|行う|実施する)?$/, '');
  return [...new Set([
    task.title,
    taskCore,
    ...targetComponentLabels(components, workload.componentPublicId),
  ]
    .map((value) => normalizedAnswerText(value))
    .filter((value) => value.length >= 2))];
}

function mentionsTargetIdentity(
  userText: string,
  task: PublicTaskV5,
  components: PublicComponentV5[],
  workload: PublicWorkloadV5,
): boolean {
  const text = normalizedAnswerText(userText);
  return normalizedIdentityCandidates(task, components, workload)
    .some((candidate) => text.includes(candidate));
}

function mentionsTargetQuantity(
  userText: string,
  workload: PublicWorkloadV5,
): boolean {
  const text = userText.normalize('NFKC').replace(/\s+/g, '');
  const amount = String(workload.amount).replace('.', '\\.');
  const unit = workload.unitLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^0-9.])${amount}${unit}(?:$|[^0-9])`).test(text);
}

function minimalEffortCorrectionReply(userText: string): boolean {
  const text = normalizedAnswerText(userText);
  return /^(?:(?:違います|違う|訂正します|修正します))?(?:(?:合計|所要時間(?:は|が)?))?(?:(?:約|およそ|だいたい))?\d+(?:\.\d+)?時間(?:(?:半)|(?:\d+(?:\.\d+)?)分)?(?:(?:くらい|ぐらい|ほど))?(?:です|だ|かかります|かかると思います|だと思います)?$/.test(text)
    || /^(?:(?:違います|違う|訂正します|修正します))?(?:(?:合計|所要時間(?:は|が)?))?(?:(?:約|およそ|だいたい))?\d+(?:\.\d+)?分(?:(?:くらい|ぐらい|ほど))?(?:です|だ|かかります|かかると思います|だと思います)?$/.test(text);
}

function explicitEffortRepairReply(params: {
  userText: string;
  task: PublicTaskV5;
  components: PublicComponentV5[];
  workload: PublicWorkloadV5;
}): boolean {
  if (
    !hasCorrectionCue(params.userText)
    || hasSchedulingFactCue(params.userText)
    || groundedDurationMinutesFromUserTextV5(params.userText).length !== 1
  ) {
    return false;
  }
  if (minimalEffortCorrectionReply(params.userText)) return true;
  return mentionsTargetQuantity(params.userText, params.workload)
    && mentionsTargetIdentity(
      params.userText,
      params.task,
      params.components,
      params.workload,
    );
}

function effortPrecision(userText: string): 'exact' | 'approximate' {
  const normalized = userText.normalize('NFKC').replace(/\s+/g, '');
  return /(?:約|およそ|だいたい|くらい|ぐらい|ほど)/.test(normalized)
    ? 'approximate'
    : 'exact';
}

export function createGroundedContextualAnswerDocumentV5(params: {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}): GroundedContextualAnswerDocumentResultV5 | null {
  const summary = params.publicStateSummary;
  const pendingQuestion = readWeeklyPlanningPendingQuestionV5(summary);
  const userText = params.userText.trim();
  if (
    !summary
    || !pendingQuestion
    || !isWeeklyPlanningContextualQuestionCodeV5(pendingQuestion.questionCode)
    || typeof pendingQuestion.targetFactId !== 'string'
    || !pendingQuestion.targetFactId
    || typeof summary.graphRevision !== 'number'
    || summary.graphRevision !== pendingQuestion.graphRevision
    || userText.length === 0
    || userText.length > 120
    || hasWeeklyPlanningContextualScopeChangeCueV5(userText)
  ) {
    return null;
  }

  const workload = readTargetWorkload(summary, pendingQuestion.targetFactId);
  if (!workload) return null;
  const task = readPublicTask(summary, workload.taskPublicId);
  if (!task) return null;
  const components = readComponents(summary, workload.taskPublicId);

  if (pendingQuestion.questionCode === 'quantity_role_unresolved') {
    const role = groundedQuantityRoleFromUserTextV5(userText);
    if (
      userText.length > 60
      || role === null
      || !quantityRoleOnlyReply(userText, role)
      || !explicitDurationMatchesTarget(userText, workload)
    ) {
      return null;
    }
    const document = emptyDocument();
    const contextualTask = taskShell(task, userText);
    contextualTask.workloads.push({
      localId: 'contextual-workload',
      quantityRole: role,
      amount: workload.amount,
      unitCode: workload.unitCode,
      unitLabel: workload.unitLabel,
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: userText,
    });
    document.tasks.push(contextualTask);
    return {
      document,
      repairs: [
        `contextual-answer-grounded-from-machine-question:${pendingQuestion.questionCode}`,
      ],
    };
  }

  const durations = groundedDurationMinutesFromUserTextV5(userText);
  const isGroundedEffortReply = durations.length === 1
    && (
      durationOnlyReply(userText)
      || explicitEffortRepairReply({ userText, task, components, workload })
    );
  if (!isGroundedEffortReply) return null;
  const document = emptyDocument();
  const contextualTask = taskShell(task, userText);
  contextualTask.effortEstimates.push({
    localId: 'contextual-effort',
    targetLocalId: contextualTask.localId,
    kind: 'total_duration',
    minutes: durations[0],
    unitCode: null,
    precision: effortPrecision(userText),
    sourceText: userText,
  });
  document.tasks.push(contextualTask);
  return {
    document,
    repairs: [
      `contextual-answer-grounded-from-machine-question:${pendingQuestion.questionCode}`,
    ],
  };
}
