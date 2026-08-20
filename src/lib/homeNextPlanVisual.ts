import type { Plan, StudyMaterial } from '../types/domain';

export type HomeNextPlanVisualKind = 'study' | 'class' | 'other';
export type HomeNextPlanSemanticKind = 'study' | 'class' | 'mock-exam' | 'other';

export interface HomeNextPlanVisual {
  kind: HomeNextPlanVisualKind;
  src: string;
}

export interface HomeNextPlanPresentation {
  visual: HomeNextPlanVisual;
  semanticKind: HomeNextPlanSemanticKind;
  detailLabel: string;
  detailValue: string;
  durationLabel: string;
  actionLabel: string;
}

export const HOME_NEXT_PLAN_VISUALS: Record<HomeNextPlanVisualKind, HomeNextPlanVisual> = {
  study: {
    kind: 'study',
    src: '/assets/home/next-plan-study.webp',
  },
  class: {
    kind: 'class',
    src: '/assets/home/next-plan-class.webp',
  },
  other: {
    kind: 'other',
    src: '/assets/home/next-plan-other.webp',
  },
};

const CLASS_HINT_PATTERN = /(授業|講義|講座|ゼミ|実習|実験|セミナー|塾|予備校)/i;

function resolveMaterialName(plan: Plan, materials: StudyMaterial[]): string {
  if (plan.materialName?.trim()) return plan.materialName.trim();
  if (plan.materialId) {
    const material = materials.find((item) => item.id === plan.materialId);
    if (material) return material.name;
  }
  return plan.subject?.trim() || '教材未設定';
}

function resolvePlanTypeLabel(plan: Plan): string {
  switch (plan.type) {
    case 'mock-exam':
      return '模試';
    case 'school-event':
      return '学校行事';
    case 'cram-school':
      return '塾・予備校';
    case 'deadline':
      return '締切';
    case 'study':
      return '学習';
    default:
      return 'その他';
  }
}

function resolveOtherCategory(plan: Plan): string {
  if (plan.type !== 'other') return resolvePlanTypeLabel(plan);
  return plan.subject?.trim() || 'その他';
}

export function resolveHomeNextPlanVisual(
  plan: Plan | null | undefined,
): HomeNextPlanVisual {
  if (!plan) return HOME_NEXT_PLAN_VISUALS.study;

  if (
    plan.sourceType === 'timetable' ||
    plan.type === 'cram-school' ||
    CLASS_HINT_PATTERN.test(`${plan.title} ${plan.subject}`)
  ) {
    return HOME_NEXT_PLAN_VISUALS.class;
  }

  if (plan.type === 'study' || plan.type === 'mock-exam') {
    return HOME_NEXT_PLAN_VISUALS.study;
  }

  return HOME_NEXT_PLAN_VISUALS.other;
}

export function resolveHomeNextPlanPresentation(
  plan: Plan,
  materials: StudyMaterial[],
): HomeNextPlanPresentation {
  const visual = resolveHomeNextPlanVisual(plan);

  if (plan.type === 'mock-exam') {
    return {
      visual,
      semanticKind: 'mock-exam',
      detailLabel: '科目',
      detailValue: plan.subject?.trim() || '模試',
      durationLabel: '試験時間',
      actionLabel: '模試を確認する',
    };
  }

  if (visual.kind === 'class') {
    return {
      visual,
      semanticKind: 'class',
      detailLabel: '科目',
      detailValue: plan.subject?.trim() || resolvePlanTypeLabel(plan),
      durationLabel: '授業時間',
      actionLabel: '授業を確認する',
    };
  }

  if (visual.kind === 'study') {
    return {
      visual,
      semanticKind: 'study',
      detailLabel: '教材',
      detailValue: resolveMaterialName(plan, materials),
      durationLabel: '予定学習時間',
      actionLabel: '学習を開始する',
    };
  }

  return {
    visual,
    semanticKind: 'other',
    detailLabel: 'カテゴリ',
    detailValue: resolveOtherCategory(plan),
    durationLabel: '予定時間',
    actionLabel: '予定を確認する',
  };
}
