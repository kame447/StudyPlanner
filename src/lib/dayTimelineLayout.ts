import { minutesBetween, minutesFromTime } from './date';

interface TimelineInterval {
  id: string;
  startTime: string;
  endTime: string;
}

interface TimelineLayoutOptions {
  hourHeight: number;
  minBlockHeight: number;
}

export function layoutTimelineEntries<T extends TimelineInterval>(
  items: T[],
  { hourHeight, minBlockHeight }: TimelineLayoutOptions,
): Array<T & { lane: number; laneCount: number }> {
  function getDisplayMetrics(item: TimelineInterval) {
    const topPx = (minutesFromTime(item.startTime) / 60) * hourHeight;
    const durationMinutes = minutesBetween(item.startTime, item.endTime);
    const heightPx = Math.max(
      (durationMinutes / 60) * hourHeight,
      minBlockHeight,
    );

    return {
      topPx,
      bottomPx: topPx + heightPx,
    };
  }

  const sortedItems = [...items].sort((left, right) => {
    const startDelta =
      minutesFromTime(left.startTime) - minutesFromTime(right.startTime);

    if (startDelta !== 0) {
      return startDelta;
    }

    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });

  const groups: T[][] = [];
  let currentGroup: T[] = [];
  let currentGroupDisplayEndPx = -1;

  sortedItems.forEach((item) => {
    const { topPx, bottomPx } = getDisplayMetrics(item);

    if (currentGroup.length === 0) {
      currentGroup = [item];
      currentGroupDisplayEndPx = bottomPx;
      return;
    }

    if (topPx < currentGroupDisplayEndPx) {
      currentGroup.push(item);
      currentGroupDisplayEndPx = Math.max(currentGroupDisplayEndPx, bottomPx);
      return;
    }

    groups.push(currentGroup);
    currentGroup = [item];
    currentGroupDisplayEndPx = bottomPx;
  });

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups.flatMap((group) => {
    const activeLanes: Array<{ lane: number; displayEndPx: number }> = [];
    const laneById = new Map<string, number>();
    let laneCount = 0;

    group.forEach((item) => {
      const { topPx, bottomPx } = getDisplayMetrics(item);

      for (let index = activeLanes.length - 1; index >= 0; index -= 1) {
        if (activeLanes[index].displayEndPx <= topPx) {
          activeLanes.splice(index, 1);
        }
      }

      const usedLanes = new Set(activeLanes.map((entry) => entry.lane));
      let lane = 0;

      while (usedLanes.has(lane)) {
        lane += 1;
      }

      laneCount = Math.max(laneCount, lane + 1);
      laneById.set(item.id, lane);
      activeLanes.push({ lane, displayEndPx: bottomPx });
    });

    return group.map((item) => ({
      ...item,
      lane: laneById.get(item.id) ?? 0,
      laneCount,
    }));
  });
}
