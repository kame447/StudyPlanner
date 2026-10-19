// Shared contract between the radial menu presentation and the calendar views
// that decide what each schedule action does. The menu renders exactly these six
// actions, clockwise from 12 o'clock, in this order.
export type ScheduleRadialActionId =
  | 'complete'
  | 'edit'
  | 'duplicate'
  | 'delete'
  | 'actual'
  | 'move';

export const SCHEDULE_RADIAL_ACTION_ORDER: readonly ScheduleRadialActionId[] = [
  'complete',
  'edit',
  'duplicate',
  'delete',
  'actual',
  'move',
];

export const SCHEDULE_RADIAL_ACTION_LABELS: Readonly<Record<ScheduleRadialActionId, string>> = {
  complete: '完了',
  edit: '編集',
  duplicate: '複製',
  delete: '削除',
  actual: '実績',
  move: '移動',
};

export interface ScheduleRadialActionDescriptor {
  id: ScheduleRadialActionId;
  label: string;
  /** Present when the action is shown but cannot run for this item. */
  disabledReason?: string | null;
}
