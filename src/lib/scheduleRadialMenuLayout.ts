export interface RadialPoint { x: number; y: number }
export interface RadialAnchorRect { left: number; top: number; width: number; height: number }
export interface RadialSafeInsets { top: number; right: number; bottom: number; left: number }

export interface ScheduleRadialMenuLayoutOptions {
  anchorRect: RadialAnchorRect;
  viewport: { width: number; height: number };
  safeInsets?: Partial<RadialSafeInsets>;
  buttonDiameter?: number;
  preferredRadius?: number;
  margin?: number;
  gap?: number;
}

export interface ScheduleRadialMenuLayout {
  anchor: RadialPoint;
  radius: number;
  buttonDiameter: number;
  nodes: readonly RadialPoint[];
  fallback: boolean;
}

const HALF_HEXAGON_WIDTH = Math.sin(Math.PI / 3);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Moves the entire regular hexagon, never individual buttons. The projection of
 * the event centre onto the feasible centre rectangle is the closest fit.
 * Only when the preferred ring cannot fit anywhere do we shrink one radius.
 * If even a non-overlapping ring cannot fit, centre that minimum ring in the
 * safe viewport and allow overflow: target size and 60-degree geometry win over
 * clipping/overlap on physically impossible viewports.
 */
export function computeScheduleRadialMenuLayout({
  anchorRect, viewport, safeInsets = {}, buttonDiameter = 56,
  preferredRadius = 80, margin = 10, gap = 6,
}: ScheduleRadialMenuLayoutOptions): ScheduleRadialMenuLayout {
  const diameter = Math.max(44, buttonDiameter);
  const half = diameter / 2;
  const left = (safeInsets.left ?? 0) + margin;
  const right = viewport.width - (safeInsets.right ?? 0) - margin;
  const top = (safeInsets.top ?? 0) + margin;
  const bottom = viewport.height - (safeInsets.bottom ?? 0) - margin;
  // The adjacent chord of this hexagon equals its radius.
  const minimumRadius = diameter + Math.max(0, gap);
  const maximumRadius = Math.min(
    (right - left - diameter) / (2 * HALF_HEXAGON_WIDTH),
    (bottom - top - diameter) / 2,
  );
  const fallback = maximumRadius < minimumRadius;
  const radius = fallback ? minimumRadius : Math.min(Math.max(minimumRadius, preferredRadius), maximumRadius);
  const anchor = fallback ? { x: (left + right) / 2, y: (top + bottom) / 2 } : {
    x: clamp(anchorRect.left + anchorRect.width / 2, left + half + radius * HALF_HEXAGON_WIDTH, right - half - radius * HALF_HEXAGON_WIDTH),
    y: clamp(anchorRect.top + anchorRect.height / 2, top + half + radius, bottom - half - radius),
  };
  const nodes = Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return { x: anchor.x + radius * Math.cos(angle), y: anchor.y + radius * Math.sin(angle) };
  });
  return { anchor, radius, buttonDiameter: diameter, nodes, fallback };
}
