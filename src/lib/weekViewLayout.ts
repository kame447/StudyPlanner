import { minutesBetween, minutesFromTime } from './date';

interface WeekViewTimeRange {
  startTime: string;
  endTime: string;
}

export interface WeekViewLane {
  lane: number;
  laneCount: number;
}

export function buildLanes<T extends WeekViewTimeRange>(items: T[]): Array<T & WeekViewLane> {
  const sorted = [...items].sort((left, right) => {
    const startDelta = minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
    if (startDelta !== 0) return startDelta;
    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });
  const active: Array<{ lane: number; endMinutes: number }> = [];
  const laidOut: Array<T & WeekViewLane> = [];
  let clusterStartIndex = 0;
  let clusterLaneCount = 0;

  const finalizeCluster = () => {
    const laneCount = Math.max(clusterLaneCount, 1);
    for (let index = clusterStartIndex; index < laidOut.length; index += 1) {
      laidOut[index].laneCount = laneCount;
    }
    clusterStartIndex = laidOut.length;
    clusterLaneCount = 0;
  };

  sorted.forEach((item) => {
    const startMinutes = minutesFromTime(item.startTime);
    const endMinutes = Math.max(
      startMinutes + minutesBetween(item.startTime, item.endTime),
      startMinutes + 1,
    );

    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].endMinutes <= startMinutes) active.splice(index, 1);
    }

    if (active.length === 0 && laidOut.length > clusterStartIndex) {
      finalizeCluster();
    }

    const used = new Set(active.map((entry) => entry.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;

    clusterLaneCount = Math.max(clusterLaneCount, lane + 1);
    laidOut.push({
      ...item,
      lane,
      laneCount: 1,
    });
    active.push({ lane, endMinutes });
  });

  if (laidOut.length > clusterStartIndex) {
    finalizeCluster();
  }

  return laidOut;
}
