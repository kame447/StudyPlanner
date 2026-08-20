import type { Plan } from '../types/domain';

export type HomeNextPlanVisualKind = 'study' | 'class' | 'other';

export interface HomeNextPlanVisual {
  kind: HomeNextPlanVisualKind;
  src: string;
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
