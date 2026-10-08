import { createActualDraftForPlan } from './actualDrafts';
import { buildMeasuredRange } from './actualTracking';
import { toIsoDate } from './date';
import type { ActualDraft, Plan, StudyMaterial } from '../types/domain';

export type StudySessionRequest = { kind: 'planned'; plan: Plan } | { kind: 'unplanned' };
export type StudySessionTarget = { kind: 'planned'; plan: Plan } | { kind: 'unplanned'; userId: string };

export function createStudySessionDraft(
  target: StudySessionTarget,
  anchorMs: number,
  durationMs: number,
  details: { title: string; subject: string; material: StudyMaterial | null },
): ActualDraft {
  const range = buildMeasuredRange(anchorMs, durationMs);
  const draft = target.kind === 'planned'
    ? createActualDraftForPlan(target.plan)
    : {
        userId: target.userId,
        planId: null,
        occurrenceDate: toIsoDate(new Date(anchorMs)),
        title: details.title.trim() || '学習',
        subject: details.subject.trim(),
        isAlignedToPlan: false,
        note: '',
        materialId: details.material?.id ?? null,
        materialName: details.material?.name ?? '',
      };
  return { ...draft, actualStartTime: range.startTime, actualEndTime: range.endTime };
}

export function sessionCrossesLocalDate(anchorMs: number, durationMs: number): boolean {
  return toIsoDate(new Date(anchorMs)) !== toIsoDate(new Date(anchorMs + durationMs));
}
