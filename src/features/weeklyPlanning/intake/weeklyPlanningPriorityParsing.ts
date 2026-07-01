import type { SetPriorityPolicyCommand } from './weeklyPlanningCommandTypes';
import type { PriorityPolicy } from './weeklyPlanningIntakeTypes';
import { resolveFieldByKeyword } from './weeklyPlanningFieldParsing';
import { splitIntakeSegments, uniqueList } from './weeklyPlanningTextParsing';

function fieldOrderWithFirst(fields: string[], firstField: string): string[] {
  return uniqueList([firstField, ...fields.filter((field) => field !== firstField)]);
}

function fieldOrderWithLast(fields: string[], lastField: string): string[] {
  return uniqueList([...fields.filter((field) => field !== lastField), lastField]);
}

function fieldFirstPolicy(order: string[]): PriorityPolicy | undefined {
  if (order.length === 0) {
    return undefined;
  }

  return {
    kind: 'field_first',
    order: uniqueList(order),
  };
}

export function parsePriorityPolicy(
  text: string,
  fields: string[],
  currentOrder: string[] = [],
): PriorityPolicy | undefined {
  const baseOrder = currentOrder.length > 0 ? currentOrder : fields;
  const mathField = resolveFieldByKeyword('\u6570\u5b66', fields);
  const softwareField = resolveFieldByKeyword('\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2', fields);

  for (const segment of splitIntakeSegments(text)) {
    const order: string[] = [];

    if (/\u6570\u5b66.*\u7d42\u308f\u3063\u305f\u3089.*\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2/.test(segment)) {
      if (mathField) order.push(mathField);
      if (softwareField) order.push(softwareField);
    }

    if (/\u6570\u5b66.*\u3088\u308a.*\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2.*\u512a\u5148|\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2.*\u512a\u5148.*\u6570\u5b66.*\u3088\u308a/.test(segment)) {
      if (softwareField) order.push(softwareField);
      if (mathField) order.push(mathField);
    }

    if (/\u307e\u305a.*\u6570\u5b66.*(?:\u305d\u306e\u3042\u3068|\u305d\u306e\u5f8c|\u6b21).*\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2/.test(segment)) {
      if (mathField) order.push(mathField);
      if (softwareField) order.push(softwareField);
    }

    if (/\u307e\u305a.*\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2.*(?:\u305d\u306e\u3042\u3068|\u305d\u306e\u5f8c|\u6b21).*\u6570\u5b66/.test(segment)) {
      if (softwareField) order.push(softwareField);
      if (mathField) order.push(mathField);
    }

    if (order.length > 0) {
      return fieldFirstPolicy(order);
    }

    if (mathField && /\u6570\u5b66.*(?:\u5148\u306b|\u512a\u5148)/.test(segment)) {
      return fieldFirstPolicy(fieldOrderWithFirst(baseOrder, mathField));
    }

    if (softwareField && /\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2.*(?:\u5148\u306b|\u512a\u5148)/.test(segment)) {
      return fieldFirstPolicy(fieldOrderWithFirst(baseOrder, softwareField));
    }

    if (mathField && /\u6570\u5b66.*(?:\u5f8c\u308d|\u5f8c\u306b|\u5f8c\u56de\u3057)/.test(segment)) {
      return fieldFirstPolicy(fieldOrderWithLast(baseOrder, mathField));
    }

    if (softwareField && /\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2.*(?:\u5f8c\u308d|\u5f8c\u306b|\u5f8c\u56de\u3057)/.test(segment)) {
      return fieldFirstPolicy(fieldOrderWithLast(baseOrder, softwareField));
    }

  }

  return undefined;
}

export function parseSetPriorityPolicyCommand(
  text: string,
  fields: string[],
  currentOrder: string[] = [],
): SetPriorityPolicyCommand | undefined {
  const policy = parsePriorityPolicy(text, fields, currentOrder);

  return policy
    ? {
        type: 'set_priority_policy',
        policy,
        sourceText: text,
        confidence: 'high',
      }
    : undefined;
}