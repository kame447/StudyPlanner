import type {
  SemanticStudyComponentV5,
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSelectedStarterTargetV5 } from './weeklyPlanningTurnEvidenceV5';
import { isUserUtteranceSourcedV5 } from './weeklyPlanningFactGraphV5';

export const WEEKLY_PLANNING_CURRENT_TURN_PROVENANCE_VERSION_V5 =
  'weekly-planning-current-turn-provenance-v5' as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizedEvidenceText(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .trim().replace(/\s+/g, ' ')
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
}

const MAX_SOURCE_FRAGMENTS_V5 = 3;
const MIN_FRAGMENT_LENGTH_V5 = 2;
// The turn controller limits the combined user and supplemental text to 4,000
// UTF-16 units. Keep the fragment fallback bounded for direct callers too.
const MAX_FRAGMENT_MATCH_TEXT_LENGTH_V5 = 4_000;

function sourceTextMatchesChannelV5(sourceText: string, channelText: string): boolean {
  if (!sourceText || !channelText) return false;
  // Preserve the established one-character contiguous evidence contract.
  if (channelText.includes(sourceText)) return true;
  if (sourceText.length > MAX_FRAGMENT_MATCH_TEXT_LENGTH_V5
    || channelText.length > MAX_FRAGMENT_MATCH_TEXT_LENGTH_V5) return false;

  const source = Array.from(sourceText);
  if (source.length < MIN_FRAGMENT_LENGTH_V5 * 2) return false;
  const masks = new Map<string, bigint>();
  source.forEach((character, index) => {
    masks.set(character, (masks.get(character) ?? 0n) | (1n << BigInt(index)));
  });

  // Bit i means that i source characters have matched. A channel character
  // may be skipped only between completed fragments; each fragment must reach
  // MIN_FRAGMENT_LENGTH_V5 before a gap can begin.
  let between = Array<bigint>(MAX_SOURCE_FRAGMENTS_V5 + 1).fill(0n);
  let oneCharacter = Array<bigint>(MAX_SOURCE_FRAGMENTS_V5 + 1).fill(0n);
  let completed = Array<bigint>(MAX_SOURCE_FRAGMENTS_V5 + 1).fill(0n);
  between[0] = 1n;
  const fullSource = 1n << BigInt(source.length);

  for (const character of channelText) {
    const mask = masks.get(character) ?? 0n;
    const advance = (positions: bigint): bigint => (positions & mask) << 1n;
    const nextBetween = between.map((positions, count) => positions | completed[count]);
    const nextOneCharacter = Array<bigint>(MAX_SOURCE_FRAGMENTS_V5 + 1).fill(0n);
    const nextCompleted = Array<bigint>(MAX_SOURCE_FRAGMENTS_V5 + 1).fill(0n);
    for (let count = 1; count <= MAX_SOURCE_FRAGMENTS_V5; count += 1) {
      nextOneCharacter[count] = advance(between[count - 1]);
      nextCompleted[count] = advance(oneCharacter[count] | completed[count]);
      if ((nextCompleted[count] & fullSource) !== 0n) return true;
    }
    between = nextBetween;
    oneCharacter = nextOneCharacter;
    completed = nextCompleted;
  }
  return false;
}

export function weeklyPlanningEvidenceChannelForSourceTextV5(
  sourceText: string,
  currentUserText: string,
  supplementalContext?: string,
): 'user' | 'supplemental' | 'ambiguous' | null {
  const normalizedSource = normalizedEvidenceText(sourceText);
  const normalizedCurrent = normalizedEvidenceText(currentUserText);
  if (!normalizedSource) return null;
  const inUser = sourceTextMatchesChannelV5(normalizedSource, normalizedCurrent);
  const inSupplemental = Boolean(supplementalContext
    && sourceTextMatchesChannelV5(
      normalizedSource,
      normalizedEvidenceText(supplementalContext),
    ));
  if (inUser && inSupplemental) return 'ambiguous';
  if (inUser) return 'user';
  if (inSupplemental) return 'supplemental';
  return null;
}

function boundRecord(
  publicStateSummary: Record<string, unknown> | undefined,
  key: 'tasks' | 'components',
  publicId: string,
): Record<string, unknown> | null {
  const candidates = recordArray(publicStateSummary?.[key]);
  return candidates.find((candidate) => candidate.publicId === publicId) ?? null;
}

function taskTitleChangedFromBound(
  task: SemanticTaskV5,
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!task.existingPublicId) return false;
  const bound = boundRecord(publicStateSummary, 'tasks', task.existingPublicId);
  return typeof bound?.title === 'string'
    && normalizedEvidenceText(bound.title) !== normalizedEvidenceText(task.title);
}

function taskShellNeedsCurrentTurnEvidence(
  task: SemanticTaskV5,
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!task.existingPublicId) return true;
  const bound = boundRecord(publicStateSummary, 'tasks', task.existingPublicId);
  if (!bound) return false;

  const titleChanged = taskTitleChangedFromBound(task, publicStateSummary);
  const categoryChanged = typeof bound.category === 'string'
    && bound.category !== task.category;
  return titleChanged || categoryChanged;
}

function componentLabelChangedFromBound(
  component: SemanticStudyComponentV5,
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!component.existingPublicId) return false;
  const bound = boundRecord(publicStateSummary, 'components', component.existingPublicId);
  return typeof bound?.label === 'string'
    && normalizedEvidenceText(bound.label) !== normalizedEvidenceText(component.label);
}

function componentShellNeedsCurrentTurnEvidence(
  component: SemanticStudyComponentV5,
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!component.existingPublicId) return true;
  const bound = boundRecord(publicStateSummary, 'components', component.existingPublicId);
  if (!bound) return false;

  const labelChanged = componentLabelChangedFromBound(component, publicStateSummary);
  const roleChanged = typeof bound.role === 'string'
    && bound.role !== component.role;
  return labelChanged || roleChanged;
}

function collectStoredContextStrings(
  publicStateSummary: Record<string, unknown> | undefined,
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5,
): Set<string> {
  const stored = new Set<string>();
  const register = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const normalized = normalizedEvidenceText(value);
    if (normalized) stored.add(normalized);
  };

  recordArray(publicStateSummary?.tasks).forEach((task) => register(task.title));
  recordArray(publicStateSummary?.components).forEach((component) => register(component.label));
  recordArray(publicStateSummary?.uncertainties).forEach((uncertainty) => {
    register(uncertainty.reason);
    register(uncertainty.sourceText);
  });
  recordArray(publicStateSummary?.userPlanningContext).forEach((fact) => {
    register(fact.label);
    register(fact.value);
  });
  register(publicStateSummary?.lastAssistantMessage);
  register(selectedStarterTarget?.label);
  return stored;
}

function contextualMachineBoundEntityValues(
  publicStateSummary: Record<string, unknown> | undefined,
): {
  taskTitles: Set<string>;
  componentLabels: Set<string>;
} {
  const taskTitles = new Set<string>();
  const componentLabels = new Set<string>();
  if (!publicStateSummary) return { taskTitles, componentLabels };

  const pendingQuestion = isRecord(publicStateSummary.pendingQuestion)
    ? publicStateSummary.pendingQuestion
    : null;
  const targetFactId = typeof pendingQuestion?.targetFactId === 'string'
    ? pendingQuestion.targetFactId
    : null;
  if (!targetFactId) return { taskTitles, componentLabels };

  const tasks = recordArray(publicStateSummary.tasks);
  const components = recordArray(publicStateSummary.components);
  const workloads = recordArray(publicStateSummary.workloads);
  const targetWorkload = workloads.find((workload) => workload.publicId === targetFactId) ?? null;
  const targetComponent = components.find((component) => component.publicId === targetFactId) ?? null;
  const targetTask = tasks.find((task) => task.publicId === targetFactId) ?? null;

  const taskPublicId = typeof targetWorkload?.taskPublicId === 'string'
    ? targetWorkload.taskPublicId
    : typeof targetComponent?.taskPublicId === 'string'
      ? targetComponent.taskPublicId
      : typeof targetTask?.publicId === 'string'
        ? targetTask.publicId
        : null;
  const componentPublicId = typeof targetWorkload?.componentPublicId === 'string'
    ? targetWorkload.componentPublicId
    : typeof targetComponent?.publicId === 'string'
      ? targetComponent.publicId
      : null;

  const task = taskPublicId
    ? tasks.find((candidate) => candidate.publicId === taskPublicId) ?? null
    : null;
  if (typeof task?.title === 'string') {
    taskTitles.add(normalizedEvidenceText(task.title));
  }

  const component = componentPublicId
    ? components.find((candidate) => candidate.publicId === componentPublicId) ?? null
    : null;
  if (typeof component?.label === 'string') {
    componentLabels.add(normalizedEvidenceText(component.label));
  }

  return { taskTitles, componentLabels };
}

function copiedExactlyFromStoredContext(params: {
  value: string | null | undefined;
  currentUserText: string;
  storedContextStrings: ReadonlySet<string>;
  machineAuthorizedValues?: ReadonlySet<string>;
}): boolean {
  if (!params.value) return false;
  const normalizedValue = normalizedEvidenceText(params.value);
  if (!normalizedValue || !params.storedContextStrings.has(normalizedValue)) return false;
  if (params.machineAuthorizedValues?.has(normalizedValue)) return false;
  return !normalizedEvidenceText(params.currentUserText).includes(normalizedValue);
}

export function validateWeeklyPlanningCurrentTurnProvenanceV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  currentUserText?: string;
  supplementalContext?: string;
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
  publicStateSummary?: Record<string, unknown>;
}): string[] {
  if (params.currentUserText === undefined) {
    const document = params.document;
    const hasAuthorityBearingContent = document.planningIntent === 'create_plan'
      || Boolean(document.planningWindow)
      || document.tasks.length > 0
      || document.relations.length > 0
      || document.availabilityDeclarations.length > 0
      || document.constraintSourceRequests.length > 0
      || (document.userContextFacts?.length ?? 0) > 0
      || document.uncertainties.length > 0
      || document.corrections.length > 0
      || document.decisions.length > 0;
    return hasAuthorityBearingContent ? ['currentUserText:missing'] : [];
  }

  const errors: string[] = [];
  const storedContextStrings = collectStoredContextStrings(
    params.publicStateSummary,
    params.selectedStarterTarget,
  );
  const machineBoundValues = contextualMachineBoundEntityValues(params.publicStateSummary);
  if (params.selectedStarterTarget) {
    const selectedLabel = normalizedEvidenceText(params.selectedStarterTarget.label);
    machineBoundValues.taskTitles.add(selectedLabel);
    machineBoundValues.componentLabels.add(selectedLabel);
  }
  const check = (sourceText: string, path: string, allowSupplemental = false): void => {
    const normalizedSource = normalizedEvidenceText(sourceText);
    const channel = weeklyPlanningEvidenceChannelForSourceTextV5(
      sourceText,
      params.currentUserText ?? '',
      params.supplementalContext,
    );
    // A fragmented user match cannot borrow the same ordered evidence from a
    // saved entity. Exact current-user quotations keep their prior behavior.
    const copiedFromStoredFragments = channel === 'user'
      && !normalizedEvidenceText(params.currentUserText ?? '').includes(normalizedSource)
      && [...storedContextStrings].some((stored) =>
        sourceTextMatchesChannelV5(normalizedSource, stored));
    if (channel === null || copiedFromStoredFragments
      || (!allowSupplemental && !isUserUtteranceSourcedV5({ channel }))) {
      errors.push(`${path}.sourceText:not-grounded-in-current-user-text`);
    }
  };
  const checkStoredCopy = (
    value: string | null | undefined,
    path: string,
    machineAuthorizedValues?: ReadonlySet<string>,
  ): void => {
    if (copiedExactlyFromStoredContext({
      value,
      currentUserText: params.currentUserText ?? '',
      storedContextStrings,
      machineAuthorizedValues,
    })) {
      errors.push(`${path}:copied-from-stored-context-without-current-mention`);
    }
  };

  if (params.document.planningWindow) {
    check(params.document.planningWindow.sourceText, 'document.planningWindow');
  }

  params.document.tasks.forEach((task, taskIndex) => {
    const taskPath = `document.tasks[${taskIndex}]`;
    if (taskShellNeedsCurrentTurnEvidence(task, params.publicStateSummary)) {
      check(task.sourceText, taskPath, true);
    }
    if (!task.existingPublicId) {
      checkStoredCopy(task.title, `${taskPath}.title`, machineBoundValues.taskTitles);
    } else if (taskTitleChangedFromBound(task, params.publicStateSummary)) {
      checkStoredCopy(task.title, `${taskPath}.title`);
    }

    task.workloads.forEach((workload, workloadIndex) => {
      check(workload.sourceText, `${taskPath}.workloads[${workloadIndex}]`, true);
    });
    task.effortEstimates.forEach((estimate, estimateIndex) => {
      check(estimate.sourceText, `${taskPath}.effortEstimates[${estimateIndex}]`, true);
    });
    task.temporalConstraints.forEach((constraint, constraintIndex) => {
      check(constraint.sourceText, `${taskPath}.temporalConstraints[${constraintIndex}]`, true);
    });
    task.recurrence.forEach((recurrence, recurrenceIndex) => {
      check(recurrence.sourceText, `${taskPath}.recurrence[${recurrenceIndex}]`, true);
    });
    (task.durableContextSignals ?? []).forEach((signal, signalIndex) => {
      const signalPath = `${taskPath}.durableContextSignals[${signalIndex}]`;
      check(signal.sourceText, signalPath);
      checkStoredCopy(signal.value, `${signalPath}.value`);
    });

    (task.study?.components ?? []).forEach((component, componentIndex) => {
      const componentPath = `${taskPath}.study.components[${componentIndex}]`;
      if (componentShellNeedsCurrentTurnEvidence(component, params.publicStateSummary)) {
        check(component.sourceText, componentPath, true);
      }
      if (!component.existingPublicId) {
        checkStoredCopy(
          component.label,
          `${componentPath}.label`,
          machineBoundValues.componentLabels,
        );
      } else if (componentLabelChangedFromBound(component, params.publicStateSummary)) {
        checkStoredCopy(component.label, `${componentPath}.label`);
      }
      component.workloads.forEach((workload, workloadIndex) => {
        check(workload.sourceText, `${componentPath}.workloads[${workloadIndex}]`, true);
      });
      (component.durableContextSignals ?? []).forEach((signal, signalIndex) => {
        const signalPath = `${componentPath}.durableContextSignals[${signalIndex}]`;
        check(signal.sourceText, signalPath);
        checkStoredCopy(signal.value, `${signalPath}.value`);
      });
    });
  });

  params.document.relations.forEach((relation, index) => {
    check(relation.sourceText, `document.relations[${index}]`, true);
  });
  params.document.availabilityDeclarations.forEach((availability, index) => {
    check(availability.sourceText, `document.availabilityDeclarations[${index}]`);
  });
  params.document.constraintSourceRequests.forEach((request, index) => {
    check(request.sourceText, `document.constraintSourceRequests[${index}]`);
  });
  (params.document.userContextFacts ?? []).forEach((fact, index) => {
    const factPath = `document.userContextFacts[${index}]`;
    check(fact.sourceText, factPath);
    checkStoredCopy(fact.label, `${factPath}.label`);
    checkStoredCopy(fact.value, `${factPath}.value`);
  });
  params.document.uncertainties.forEach((uncertainty, index) => {
    const uncertaintyPath = `document.uncertainties[${index}]`;
    check(uncertainty.sourceText, uncertaintyPath);
    checkStoredCopy(uncertainty.reason, `${uncertaintyPath}.reason`);
  });
  params.document.corrections.forEach((correction, index) => {
    check(correction.sourceText, `document.corrections[${index}]`);
  });
  params.document.decisions.forEach((decision, index) => {
    check(decision.sourceText, `document.decisions[${index}]`);
  });

  return errors;
}
