import type { RadialPoint, ScheduleRadialMenuLayout } from './scheduleRadialMenuLayout';

export const SCHEDULE_RADIAL_GESTURE_START = 'studyplanner:schedule-radial-gesture-start';
export interface ScheduleRadialGesture {
  origin: RadialPoint;
  point: RadialPoint;
  onMove?: (point: RadialPoint) => void;
  onRelease?: () => void;
}

/** Select in the rendered ring, while retaining a dead zone at the held finger. */
export function selectScheduleRadialGesture(layout: ScheduleRadialMenuLayout, point: RadialPoint, origin: RadialPoint): number | null {
  if (![point.x, point.y, origin.x, origin.y, layout.anchor.x, layout.anchor.y].every(Number.isFinite)) return null;
  if (Math.hypot(point.x - origin.x, point.y - origin.y) <= 24) return null;
  const dx = point.x - layout.anchor.x;
  const dy = point.y - layout.anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 24 || distance > layout.radius + layout.buttonDiameter + 40) return null;
  const angle = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return Math.round(angle / (Math.PI / 3)) % 6;
}
