import type { PlanType } from '../types/domain';

export const PLAN_TYPE_OPTIONS: Array<{ value: PlanType; label: string }> = [
  { value: 'study', label: '勉強' },
  { value: 'mock-exam', label: '模試' },
  { value: 'school-event', label: '学校行事' },
  { value: 'cram-school', label: '塾' },
  { value: 'deadline', label: '締切' },
  { value: 'other', label: 'その他' },
];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  study: '勉強',
  'mock-exam': '模試',
  'school-event': '学校行事',
  'cram-school': '塾',
  deadline: '締切',
  other: 'その他',
};

export function getPlanTypeLabel(type: PlanType): string {
  return PLAN_TYPE_LABELS[type];
}

export function isPrimaryEvent(type: PlanType): boolean {
  return type !== 'study';
}

export function buildDefaultPlanTitle(
  type: PlanType,
  subject: string,
): string {
  const trimmedSubject = subject.trim();

  if (type === 'study') {
    return trimmedSubject ? `${trimmedSubject}の勉強` : '勉強予定';
  }

  if (type === 'mock-exam') {
    return trimmedSubject ? `${trimmedSubject}模試` : '模試';
  }

  if (type === 'school-event') {
    return '学校行事';
  }

  if (type === 'cram-school') {
    return trimmedSubject ? `${trimmedSubject}の塾` : '塾';
  }

  if (type === 'deadline') {
    return trimmedSubject ? `${trimmedSubject}の締切` : '締切';
  }

  return trimmedSubject ? trimmedSubject : '予定';
}
