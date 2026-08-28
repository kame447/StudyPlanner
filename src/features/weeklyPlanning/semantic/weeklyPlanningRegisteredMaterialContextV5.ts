import { getMaterialUnitLabel } from '../../../lib/materialPace';
import type {
  StudyMaterial,
  StudyMaterialProgressUnit,
} from '../../../types/domain';
import type {
  SemanticStudyComponentV5,
  SemanticTaskV5,
  SemanticWorkloadUnitCodeV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticTypesV5';

const MAX_REGISTERED_MATERIALS = 120;
const registeredMaterialsByOwner = new Map<string, StudyMaterial[]>();

export interface WeeklyPlanningRegisteredMaterialSummaryV5 {
  publicId: string;
  name: string;
  aliases: string[];
  progressUnit: StudyMaterialProgressUnit | null;
  progressUnitLabel: string | null;
  totalUnits: number | null;
  currentUnit: number | null;
  estimatedMinutesPerUnit: number | null;
  targetDate: string | null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function normalizeWeeklyPlanningMaterialIdentityV5(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\s\-‐‑‒–—―・･:：,，.．!！?？'"「」『』（）()【】\[\]]+/g, '');
}

export function setWeeklyPlanningRegisteredMaterialRuntimeV5(params: {
  ownerId: string;
  materials: readonly StudyMaterial[];
}): void {
  registeredMaterialsByOwner.set(
    params.ownerId,
    params.materials
      .filter((material) =>
        material.userId === params.ownerId && material.status !== 'archived')
      .slice(0, MAX_REGISTERED_MATERIALS)
      .map((material) => ({
        ...material,
        aliases: material.aliases ? [...material.aliases] : undefined,
      })),
  );
}

export function clearWeeklyPlanningRegisteredMaterialRuntimeV5(ownerId: string): void {
  registeredMaterialsByOwner.delete(ownerId);
}

export function getWeeklyPlanningRegisteredMaterialsV5(ownerId: string): StudyMaterial[] {
  return (registeredMaterialsByOwner.get(ownerId) ?? []).map((material) => ({
    ...material,
    aliases: material.aliases ? [...material.aliases] : undefined,
  }));
}

export function createWeeklyPlanningRegisteredMaterialSummariesV5(
  materials: readonly StudyMaterial[],
): WeeklyPlanningRegisteredMaterialSummaryV5[] {
  return materials.slice(0, MAX_REGISTERED_MATERIALS).map((material) => ({
    publicId: material.id,
    name: material.name,
    aliases: (material.aliases ?? []).filter(Boolean),
    progressUnit: material.progressUnit ?? null,
    progressUnitLabel: material.progressUnit === 'custom'
      ? material.progressUnitLabel?.trim() || null
      : getMaterialUnitLabel(material),
    totalUnits: finitePositive(material.totalUnits),
    currentUnit: finiteNonNegative(material.currentUnit),
    estimatedMinutesPerUnit: finitePositive(material.estimatedMinutesPerUnit),
    targetDate: material.targetDate?.trim() || null,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSummary(value: unknown): WeeklyPlanningRegisteredMaterialSummaryV5 | null {
  if (!isRecord(value)
    || typeof value.publicId !== 'string'
    || typeof value.name !== 'string'
    || !Array.isArray(value.aliases)
    || !value.aliases.every((alias) => typeof alias === 'string')) {
    return null;
  }
  const progressUnit = value.progressUnit;
  if (progressUnit !== null
    && progressUnit !== 'page'
    && progressUnit !== 'problem'
    && progressUnit !== 'section'
    && progressUnit !== 'video'
    && progressUnit !== 'word'
    && progressUnit !== 'custom') {
    return null;
  }
  return {
    publicId: value.publicId,
    name: value.name,
    aliases: [...value.aliases],
    progressUnit,
    progressUnitLabel: typeof value.progressUnitLabel === 'string'
      ? value.progressUnitLabel
      : null,
    totalUnits: finitePositive(value.totalUnits),
    currentUnit: finiteNonNegative(value.currentUnit),
    estimatedMinutesPerUnit: finitePositive(value.estimatedMinutesPerUnit),
    targetDate: typeof value.targetDate === 'string' && value.targetDate.trim()
      ? value.targetDate
      : null,
  };
}

export function registeredStudyMaterialsFromPublicStateV5(
  publicStateSummary?: Record<string, unknown>,
): WeeklyPlanningRegisteredMaterialSummaryV5[] {
  const raw = publicStateSummary?.registeredStudyMaterials;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseSummary)
    .filter((entry): entry is WeeklyPlanningRegisteredMaterialSummaryV5 => Boolean(entry));
}

export function findRegisteredStudyMaterialForLabelV5(params: {
  label: string;
  materials: readonly WeeklyPlanningRegisteredMaterialSummaryV5[];
}): WeeklyPlanningRegisteredMaterialSummaryV5 | null {
  const normalizedLabel = normalizeWeeklyPlanningMaterialIdentityV5(params.label);
  if (!normalizedLabel) return null;
  const matches = params.materials.filter((material) => {
    const identities = [material.name, ...material.aliases]
      .map(normalizeWeeklyPlanningMaterialIdentityV5)
      .filter(Boolean);
    return identities.includes(normalizedLabel);
  });
  return matches.length === 1 ? matches[0] : null;
}

function semanticUnitCode(
  unit: StudyMaterialProgressUnit | null,
): SemanticWorkloadUnitCodeV5 | null {
  switch (unit) {
    case 'page':
      return 'page';
    case 'problem':
      return 'problem';
    case 'section':
      return 'section';
    case 'word':
      return 'word';
    case 'video':
      return 'lesson';
    case 'custom':
      return 'custom';
    default:
      return null;
  }
}

function defaultUnitLabel(unit: StudyMaterialProgressUnit | null): string {
  switch (unit) {
    case 'page':
      return 'ページ';
    case 'problem':
      return '問';
    case 'section':
      return '章';
    case 'video':
      return '本';
    case 'word':
      return '語';
    default:
      return '単位';
  }
}

function targetMaterialLabel(task: SemanticTaskV5): Array<{
  localId: string;
  label: string;
  sourceText: string;
  workloads: SemanticStudyComponentV5['workloads'];
  kind: 'task' | 'component';
}> {
  const components = (task.study?.components ?? [])
    .filter((component) => component.role === 'material')
    .map((component) => ({
      localId: component.localId,
      label: component.label,
      sourceText: component.sourceText,
      workloads: component.workloads,
      kind: 'component' as const,
    }));
  return [
    ...components,
    {
      localId: task.localId,
      label: task.title,
      sourceText: task.sourceText,
      workloads: task.workloads,
      kind: 'task' as const,
    },
  ];
}

export function applyRegisteredStudyMaterialEvidenceV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
} {
  const materials = registeredStudyMaterialsFromPublicStateV5(params.publicStateSummary);
  if (materials.length === 0) return { document: params.document, repairs: [] };

  const document = structuredClone(params.document);
  const repairs: string[] = [];
  const resolvedTargetIds = new Set<string>();

  for (const task of document.tasks) {
    for (const target of targetMaterialLabel(task)) {
      const material = findRegisteredStudyMaterialForLabelV5({
        label: target.label,
        materials,
      });
      if (!material) continue;
      const unitCode = semanticUnitCode(material.progressUnit);
      if (!unitCode) continue;
      const unitLabel = material.progressUnitLabel?.trim()
        || defaultUnitLabel(material.progressUnit);
      const hasScopeTotal = target.workloads.some((workload) =>
        workload.quantityRole === 'scope_total' && workload.unitCode === unitCode);
      const hasCompleted = target.workloads.some((workload) =>
        workload.quantityRole === 'completed' && workload.unitCode === unitCode);

      if (material.totalUnits !== null && !hasScopeTotal) {
        target.workloads.push({
          localId: `${target.localId}__registered_scope_total`,
          quantityRole: 'scope_total',
          amount: material.totalUnits,
          unitCode,
          unitLabel,
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText: target.sourceText,
        });
        repairs.push(`registered-material-scope-total:${target.localId}:${material.publicId}`);
      }
      if (material.currentUnit !== null && !hasCompleted) {
        target.workloads.push({
          localId: `${target.localId}__registered_completed`,
          quantityRole: 'completed',
          amount: material.currentUnit,
          unitCode,
          unitLabel,
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText: target.sourceText,
        });
        repairs.push(`registered-material-completed:${target.localId}:${material.publicId}`);
      }
      const totalAndProgressKnown = material.totalUnits !== null && material.currentUnit !== null;
      if (totalAndProgressKnown) resolvedTargetIds.add(target.localId);

      if (material.estimatedMinutesPerUnit !== null) {
        const workloadTarget = target.workloads.find((workload) =>
          workload.unitCode === unitCode
          && workload.quantityRole !== 'completed');
        const hasMatchingEstimate = task.effortEstimates.some((estimate) =>
          estimate.targetLocalId === workloadTarget?.localId
          && estimate.kind === 'duration_per_unit'
          && estimate.unitCode === unitCode);
        if (workloadTarget && !hasMatchingEstimate) {
          task.effortEstimates.push({
            localId: `${workloadTarget.localId}__registered_effort`,
            targetLocalId: workloadTarget.localId,
            kind: 'duration_per_unit',
            minutes: material.estimatedMinutesPerUnit,
            unitCode,
            precision: 'approximate',
            sourceText: target.sourceText,
          });
          repairs.push(`registered-material-effort:${target.localId}:${material.publicId}`);
        }
      }
    }
  }

  if (resolvedTargetIds.size > 0) {
    document.uncertainties = document.uncertainties.filter((uncertainty) =>
      !(uncertainty.field === 'work_breakdown'
        && resolvedTargetIds.has(uncertainty.targetLocalId)));
  }

  return { document, repairs };
}

export function registeredMaterialProgressQuestionV5(params: {
  label: string;
  materials: readonly WeeklyPlanningRegisteredMaterialSummaryV5[];
}): string | null {
  const material = findRegisteredStudyMaterialForLabelV5(params);
  if (!material) return null;
  const unitLabel = material.progressUnitLabel?.trim()
    || defaultUnitLabel(material.progressUnit);
  if (material.totalUnits !== null && material.currentUnit === null) {
    return `「${params.label}」は全${material.totalUnits}${unitLabel}で登録されています。今どこまで終わっていますか？`;
  }
  if (material.totalUnits === null && material.currentUnit !== null) {
    return `「${params.label}」は今${material.currentUnit}${unitLabel}まで進んでいます。全部で何${unitLabel}くらいありますか？`;
  }
  if (material.totalUnits !== null && material.currentUnit !== null) {
    return null;
  }
  switch (material.progressUnit) {
    case 'problem':
      return `「${params.label}」って、全部で何問くらいあって、今何問くらい終わっていますか？`;
    case 'word':
      return `「${params.label}」って、全部で何語くらいあって、今何語くらいまで確認できていますか？`;
    case 'section':
      return `「${params.label}」って、全部で何章くらいあって、今どこまで終わっていますか？`;
    case 'video':
      return `「${params.label}」って、全部で何本くらいあって、今何本くらい見終わっていますか？`;
    case 'custom':
      return `「${params.label}」って、全部で何${unitLabel}くらいあって、今どこまで終わっていますか？`;
    case 'page':
    default:
      return `「${params.label}」って、全部で何ページくらいあって、今何ページくらいまで終わっていますか？`;
  }
}

export function resetWeeklyPlanningRegisteredMaterialRuntimeForTestV5(): void {
  registeredMaterialsByOwner.clear();
}
