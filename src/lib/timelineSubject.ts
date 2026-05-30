import { resolveMaterialSubjectName } from './materialSubject';
import { getSubjectLabel, getSubjectTheme, type SubjectTheme } from './subjectTheme';
import type {
  PlanSourceType,
  PlanType,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

const NON_SUBJECT_LABELS = new Set(['予定', '記録']);

export interface TimelineSubjectInput {
  subject: string;
  type: PlanType;
  sourceType?: PlanSourceType;
  materialId?: string | null;
  materialName?: string;
  title?: string;
}

export interface TimelineSubjectContext {
  materialsById: Map<string, StudyMaterial>;
  subjectsById: Map<string, StudySubject>;
  subjectsByName: Map<string, StudySubject>;
}

export interface TimelineSubjectDisplay {
  label: string;
  theme: SubjectTheme;
}

export function buildThemeFromSubjectColor(color: string): SubjectTheme {
  return {
    fill: color,
    soft: `color-mix(in srgb, ${color} 14%, var(--surface-strong) 86%)`,
    border: `color-mix(in srgb, ${color} 42%, var(--border) 58%)`,
    text: color,
  };
}

function isDisplayableSubjectLabel(value: string): boolean {
  return value.trim().length > 0 && !NON_SUBJECT_LABELS.has(value.trim());
}

function resolveMaterialByName(
  materialName: string | undefined,
  materials: StudyMaterial[],
): StudyMaterial | null {
  const normalizedName = materialName?.trim();

  if (!normalizedName) {
    return null;
  }

  return materials.find((material) => material.name.trim() === normalizedName) ?? null;
}

export function resolveTimelineSubjectDisplay(
  entry: TimelineSubjectInput,
  context: TimelineSubjectContext,
): TimelineSubjectDisplay {
  const subject = entry.subject.trim();
  const materials = Array.from(context.materialsById.values());
  const material =
    (entry.materialId ? context.materialsById.get(entry.materialId) : null) ??
    resolveMaterialByName(entry.materialName, materials);

  if (isDisplayableSubjectLabel(subject)) {
    const subjectRecord = context.subjectsByName.get(subject);
    const materialSubjectLabel = resolveMaterialSubjectName(
      material,
      Array.from(context.subjectsById.values()),
    );
    const materialColor =
      materialSubjectLabel === subject
        ? context.subjectsById.get(material?.subjectId ?? '')?.color || material?.color
        : undefined;

    return {
      label: subject,
      theme:
        subjectRecord?.color || materialColor
          ? buildThemeFromSubjectColor(subjectRecord?.color || materialColor || '')
          : getSubjectTheme(subject, entry.type, entry.sourceType),
    };
  }

  const materialSubjectLabel = resolveMaterialSubjectName(
    material,
    Array.from(context.subjectsById.values()),
  );

  if (materialSubjectLabel) {
    const subjectRecord =
      material && context.subjectsById.get(material.subjectId)
        ? context.subjectsById.get(material.subjectId)
        : context.subjectsByName.get(materialSubjectLabel);

    return {
      label: materialSubjectLabel,
      theme:
        subjectRecord?.color || material?.color
          ? buildThemeFromSubjectColor(subjectRecord?.color || material?.color || '')
          : getSubjectTheme(materialSubjectLabel, entry.type, entry.sourceType),
    };
  }

  const fallbackLabel = getSubjectLabel(
    entry.subject,
    entry.type,
    entry.sourceType,
  ).trim();

  if (isDisplayableSubjectLabel(fallbackLabel)) {
    return {
      label: fallbackLabel,
      theme: getSubjectTheme(fallbackLabel, entry.type, entry.sourceType),
    };
  }

  const looseFallback =
    entry.materialName?.trim() || entry.title?.trim() || subject || '教科未設定';

  return {
    label: looseFallback,
    theme: getSubjectTheme('', entry.type, entry.sourceType),
  };
}
