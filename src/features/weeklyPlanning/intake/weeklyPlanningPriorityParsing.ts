import type { PriorityPolicy } from './weeklyPlanningIntakeTypes';
import { resolveFieldByKeyword } from './weeklyPlanningFieldParsing';
import { splitIntakeSegments, uniqueList } from './weeklyPlanningTextParsing';

export function parsePriorityPolicy(text: string, fields: string[]): PriorityPolicy | undefined {
  const mathField = resolveFieldByKeyword("数学", fields);
  const softwareField = resolveFieldByKeyword("ソフトウェア", fields);

  for (const segment of splitIntakeSegments(text)) {
    const order: string[] = [];

    if (/数学.*終わったら.*ソフトウェア/.test(segment)) {
      if (mathField) order.push(mathField);
      if (softwareField) order.push(softwareField);
    }

    if (/数学.*より.*ソフトウェア.*優先|ソフトウェア.*優先.*数学.*より/.test(segment)) {
      if (softwareField) order.push(softwareField);
      if (mathField) order.push(mathField);
    }

    if (order.length > 0) {
      return {
        kind: "field_first",
        order: uniqueList(order),
      };
    }
  }

  return undefined;
}
