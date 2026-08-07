import type {
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

interface TextSegmentV5 {
  start: number;
  end: number;
  text: string;
}

interface TaskEvidenceV5 {
  taskLocalId: string;
  evidenceTexts: string[];
}

function sentenceSegments(text: string): TextSegmentV5[] {
  const segments: TextSegmentV5[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/[。.!?！？]/u.test(text[index])) continue;
    const end = index + 1;
    const value = text.slice(start, end).trim();
    if (value) segments.push({ start, end, text: value });
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) segments.push({ start, end: text.length, text: tail });
  return segments;
}

function exactEvidenceTexts(task: SemanticTaskV5, userText: string): string[] {
  const values = [
    task.sourceText,
    ...(task.study?.components.map((component) => component.sourceText) ?? []),
  ];
  return [...new Set(values.map((value) => value.trim()).filter((value) =>
    value.length >= 2 && userText.includes(value),
  ))];
}

function taskEvidence(document: WeeklyPlanningSemanticDocumentV5, userText: string): TaskEvidenceV5[] {
  return document.tasks.map((task) => ({
    taskLocalId: task.localId,
    evidenceTexts: exactEvidenceTexts(task, userText),
  }));
}

function mentionedTaskIds(segment: string, evidence: TaskEvidenceV5[]): Set<string> {
  return new Set(evidence
    .filter((entry) => entry.evidenceTexts.some((text) => segment.includes(text)))
    .map((entry) => entry.taskLocalId));
}

function workloadOwners(document: WeeklyPlanningSemanticDocumentV5): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const add = (sourceText: string, taskLocalId: string) => {
    const key = sourceText.trim();
    if (!key) return;
    const owners = result.get(key) ?? new Set<string>();
    owners.add(taskLocalId);
    result.set(key, owners);
  };

  for (const task of document.tasks) {
    for (const workload of task.workloads) add(workload.sourceText, task.localId);
    for (const component of task.study?.components ?? []) {
      for (const workload of component.workloads) add(workload.sourceText, task.localId);
    }
  }
  return result;
}

function hasModifierTargetUncertainty(
  document: WeeklyPlanningSemanticDocumentV5,
  sourceText: string,
): boolean {
  return document.uncertainties.some((uncertainty) =>
    uncertainty.field === 'modifier_target'
    && uncertainty.sourceText.trim() === sourceText.trim(),
  );
}

export function validateWeeklyPlanningStandaloneModifierTargetsV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  userText: string;
}): string[] {
  if (params.document.tasks.length < 2) return [];

  const segments = sentenceSegments(params.userText);
  if (segments.length < 2) return [];
  const evidence = taskEvidence(params.document, params.userText);
  const ownersBySource = workloadOwners(params.document);
  const errors: string[] = [];

  for (const [sourceText, attachedOwners] of ownersBySource) {
    if (attachedOwners.size !== 1 || hasModifierTargetUncertainty(params.document, sourceText)) continue;

    const sourceIndex = params.userText.lastIndexOf(sourceText);
    if (sourceIndex < 0) continue;
    const segmentIndex = segments.findIndex((segment) =>
      sourceIndex >= segment.start && sourceIndex < segment.end,
    );
    if (segmentIndex <= 0) continue;

    const currentSegment = segments[segmentIndex].text;
    const currentMentions = mentionedTaskIds(currentSegment, evidence);
    if ([...attachedOwners].some((owner) => currentMentions.has(owner))) continue;

    const previousSegment = segments[segmentIndex - 1].text;
    const previousMentions = mentionedTaskIds(previousSegment, evidence);
    if (previousMentions.size < 2) continue;

    errors.push(
      `ambiguous-standalone-modifier-target:${sourceText}:candidate-count=${previousMentions.size}:attached-count=${attachedOwners.size}`,
    );
  }

  return errors;
}
