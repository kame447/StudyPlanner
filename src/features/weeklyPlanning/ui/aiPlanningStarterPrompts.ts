import type { Plan, StudyMaterial, TodoTask } from '../../../types/domain';

export const AI_PLANNING_FALLBACK_PROMPTS = [
  '今週の課題を優先して、空き時間に無理なく入れて',
  '課題や提出物を締切から逆算して計画して',
  '毎日少しずつ続けられる学習計画を作って',
] as const;

interface StarterPromptCandidate {
  key: string;
  prompt: string;
  priority: number;
  date: string | null;
}

interface BuildAiPlanningStarterPromptsInput {
  referenceDate: string;
  plans: readonly Plan[];
  todos: readonly TodoTask[];
  materials: readonly StudyMaterial[];
  limit?: number;
}

function formatShortDate(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase('ja');
}

function isIncompleteMaterial(material: StudyMaterial): boolean {
  if (material.status === 'archived') return false;
  if (typeof material.totalUnits !== 'number' || typeof material.currentUnit !== 'number') {
    return true;
  }
  return material.currentUnit < material.totalUnits;
}

function compareCandidates(left: StarterPromptCandidate, right: StarterPromptCandidate): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.date && right.date && left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.date && !right.date) return -1;
  if (!left.date && right.date) return 1;
  return left.prompt.localeCompare(right.prompt, 'ja');
}

function addCandidate(
  candidates: StarterPromptCandidate[],
  seenTargets: Set<string>,
  candidate: StarterPromptCandidate,
): void {
  const targetKey = normalizeKey(candidate.key);
  if (!targetKey || seenTargets.has(targetKey)) return;
  seenTargets.add(targetKey);
  candidates.push(candidate);
}

export function buildAiPlanningStarterPrompts({
  referenceDate,
  plans,
  todos,
  materials,
  limit = 3,
}: BuildAiPlanningStarterPromptsInput): string[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const candidates: StarterPromptCandidate[] = [];
  const seenTargets = new Set<string>();

  plans
    .filter((plan) => plan.type === 'mock-exam' && plan.date >= referenceDate)
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach((plan) => {
      addCandidate(candidates, seenTargets, {
        key: plan.title,
        prompt: `${formatShortDate(plan.date)}の${plan.title}に向けて学習計画を作って`,
        priority: 0,
        date: plan.date,
      });
    });

  todos
    .filter((todo) => todo.status !== 'done' && todo.status !== 'archived')
    .sort((left, right) => {
      if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
        return left.dueDate.localeCompare(right.dueDate);
      }
      if (left.dueDate && !right.dueDate) return -1;
      if (!left.dueDate && right.dueDate) return 1;
      if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
      return left.createdAt.localeCompare(right.createdAt);
    })
    .forEach((todo) => {
      const overdue = Boolean(todo.dueDate && todo.dueDate < referenceDate);
      const prompt = todo.dueDate
        ? overdue
          ? `${todo.title}を優先して終えられるように計画して`
          : `${todo.title}を${formatShortDate(todo.dueDate)}までに終えられるように計画して`
        : `${todo.title}を進める学習計画を作って`;
      addCandidate(candidates, seenTargets, {
        key: todo.title,
        prompt,
        priority: 1,
        date: todo.dueDate,
      });
    });

  materials
    .filter(isIncompleteMaterial)
    .sort((left, right) => {
      if (left.targetDate && right.targetDate && left.targetDate !== right.targetDate) {
        return left.targetDate.localeCompare(right.targetDate);
      }
      if (left.targetDate && !right.targetDate) return -1;
      if (!left.targetDate && right.targetDate) return 1;
      return left.updatedAt.localeCompare(right.updatedAt) * -1;
    })
    .forEach((material) => {
      const targetDate = material.targetDate ?? null;
      const overdue = Boolean(targetDate && targetDate < referenceDate);
      const prompt = targetDate
        ? overdue
          ? `${material.name}を優先して進める学習計画を作って`
          : `${material.name}を${formatShortDate(targetDate)}までに終えられるように計画して`
        : `${material.name}を今週進める学習計画を作って`;
      addCandidate(candidates, seenTargets, {
        key: material.name,
        prompt,
        priority: 2,
        date: targetDate,
      });
    });

  plans
    .filter((plan) => plan.type === 'deadline' && plan.date >= referenceDate)
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach((plan) => {
      addCandidate(candidates, seenTargets, {
        key: plan.title,
        prompt: `${plan.title}を${formatShortDate(plan.date)}までに終えられるように計画して`,
        priority: 1,
        date: plan.date,
      });
    });

  const prompts = candidates
    .sort(compareCandidates)
    .slice(0, normalizedLimit)
    .map((candidate) => candidate.prompt);

  for (const fallback of AI_PLANNING_FALLBACK_PROMPTS) {
    if (prompts.length >= normalizedLimit) break;
    if (!prompts.includes(fallback)) prompts.push(fallback);
  }

  return prompts.slice(0, normalizedLimit);
}
