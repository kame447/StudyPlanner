import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, content) {
  const directory = path.split('/').slice(0, -1).join('/');
  if (directory) mkdirSync(directory, { recursive: true });
  writeFileSync(path, content, 'utf8');
}
function replaceOnce(path, before, after) {
  const source = read(path);
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found in ${path}: ${before.slice(0, 140)}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`anchor not unique in ${path}`);
  write(path, source.slice(0, index) + after + source.slice(index + before.length));
}

write('src/features/weeklyPlanning/dialogue/weeklyPlanningKnownFixedEvents.ts', `import { addDays } from '../../../lib/date';
import { expandPlansForDateRange } from '../../../lib/planRecurrence';
import type { Plan } from '../../../types/domain';
import type { PlanningRange } from '../intake/weeklyPlanningIntakeTypes';

function dateOnly(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function normalizedBoundary(value: string | undefined, edge: 'start' | 'end'): string | undefined {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return undefined;
  const time = value.includes('T') ? value.slice(11, 19) : '';
  if (time.length >= 5) {
    return date + 'T' + time.slice(0, 5) + ':00';
  }
  return edge === 'start' ? date + 'T00:00:00' : date + 'T23:59:59';
}

function occurrenceStart(plan: Plan): string {
  return plan.date + 'T' + plan.startTime.slice(0, 5) + ':00';
}

function occurrenceEnd(plan: Plan): string {
  const start = plan.startTime.slice(0, 5);
  const end = plan.endTime.slice(0, 5);
  const endDate = end <= start && end !== '24:00' ? addDays(plan.date, 1) : plan.date;
  return endDate + 'T' + end + ':00';
}

function overlapsRange(plan: Plan, start: string, end: string): boolean {
  return occurrenceEnd(plan) > start && occurrenceStart(plan) < end;
}

function sortOccurrences(left: Plan, right: Plan): number {
  return left.date.localeCompare(right.date)
    || left.startTime.localeCompare(right.startTime)
    || left.endTime.localeCompare(right.endTime)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function formatDate(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  return Number(month) + '/' + Number(day);
}

function formatPlan(plan: Plan): string {
  return formatDate(plan.date) + ' ' + plan.startTime + '〜' + plan.endTime + '「' + plan.title + '」';
}

export function createKnownFixedEventOccurrences(
  plans: readonly Plan[],
  range: PlanningRange | undefined,
): Plan[] {
  const start = normalizedBoundary(range?.startDateTime, 'start');
  const end = normalizedBoundary(range?.endDateTime, 'end');
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);
  if (!start || !end || !startDate || !endDate || end <= start) return [];

  return expandPlansForDateRange([...plans], startDate, endDate)
    .filter((plan) => overlapsRange(plan, start, end))
    .sort(sortOccurrences);
}

export function createKnownFixedEventSummaries(
  plans: readonly Plan[],
  range: PlanningRange | undefined,
  maxItems = 3,
): string[] {
  if (maxItems <= 0) return [];
  const matching = createKnownFixedEventOccurrences(plans, range);
  const summaries = matching.slice(0, maxItems).map(formatPlan);
  const remaining = matching.length - summaries.length;
  return remaining > 0 ? [...summaries, 'ほか' + remaining + '件'] : summaries;
}
`);

replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `import type { Plan, ScheduleTemplate } from '../../../types/domain';`,
  `import type { Plan, ScheduleTemplate } from '../../../types/domain';\nimport { createKnownFixedEventOccurrences } from '../dialogue/weeklyPlanningKnownFixedEvents';`,
);
replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `function createPlannerCapabilitySnapshot(\n  input: WeeklyPlanningIntakePipelineInput,\n): PlannerCapabilitySnapshot {`,
  `function createPlannerCapabilitySnapshot(\n  input: WeeklyPlanningIntakePipelineInput,\n  state: PlanningIntakeState,\n): PlannerCapabilitySnapshot {`,
);
replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `    existingPlanCount: (input.existingPlans ?? []).length,`,
  `    existingPlanCount: createKnownFixedEventOccurrences(\n      input.existingPlans ?? [],\n      state.range,\n    ).length,`,
);
replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `  const capabilitySnapshot = createPlannerCapabilitySnapshot(input);`,
  `  const capabilitySnapshot = createPlannerCapabilitySnapshot(input, preparedState);`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `function renderFallback(input: BehaviorAwareDialoguePlannerInput): string {`,
  `function hasGroundedAvailabilityAction(input: BehaviorAwareDialoguePlannerInput): boolean {\n  return input.allowedActions.some((action) =>\n    action.topicId === 'availability-basis'\n    || action.topicId === 'feasibility_basis',\n  );\n}\n\nfunction renderFallback(input: BehaviorAwareDialoguePlannerInput): string {`,
);
replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `      if (effectiveInput.clarificationRequest) {\n        return {\n          message: renderFallback(effectiveInput),\n          response: null,\n          source: 'deterministic_fallback' as const,\n        };\n      }`,
  `      if (effectiveInput.clarificationRequest || hasGroundedAvailabilityAction(effectiveInput)) {\n        return {\n          message: renderFallback(effectiveInput),\n          response: null,\n          source: 'deterministic_fallback' as const,\n        };\n      }`,
);

write('src/features/weeklyPlanning/dialogue/weeklyPlanningKnownFixedEvents.test.ts', `import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import { fallbackQuestionForSlot } from '../intake/weeklyPlanningQuestionSlots';
import {
  createKnownFixedEventOccurrences,
  createKnownFixedEventSummaries,
} from './weeklyPlanningKnownFixedEvents';

function plan(id: string, date: string, startTime: string, endTime: string, title: string): Plan {
  return {
    id,
    userId: 'user',
    date,
    startTime,
    endTime,
    title,
    subject: '',
    type: 'other',
    memo: '',
    repeat: 'none',
    repeatUntil: null,
    recurrenceRules: [],
    excludedDates: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  } as Plan;
}

const range = {
  confidence: 'explicit' as const,
  startDateTime: '2026-07-16T12:00:00',
  endDateTime: '2026-07-19T18:00:00',
};

describe('known fixed event occurrences', () => {
  it('uses exact datetime overlap instead of date-only inclusion', () => {
    const occurrences = createKnownFixedEventOccurrences([
      plan('before', '2026-07-16', '09:00', '10:00', '開始前'),
      plan('overlap-start', '2026-07-16', '11:30', '12:30', '開始境界と重なる'),
      plan('inside', '2026-07-17', '10:00', '11:00', '範囲内'),
      plan('overlap-end', '2026-07-19', '17:30', '18:30', '終了境界と重なる'),
      plan('after', '2026-07-19', '18:00', '19:00', '終了後'),
    ], range);

    expect(occurrences.map((item) => item.id)).toEqual(['overlap-start', 'inside', 'overlap-end']);
  });

  it('expands weekly recurring plans into the planning range', () => {
    const recurring = {
      ...plan('weekly', '2026-07-09', '14:00', '15:00', '毎週の授業'),
      repeat: 'weekly' as const,
      repeatUntil: '2026-08-31',
    };
    const summaries = createKnownFixedEventSummaries([recurring], range);
    expect(summaries).toEqual(['7/16 14:00〜15:00「毎週の授業」']);
  });

  it('uses only registered occurrences inside the planning range', () => {
    const summaries = createKnownFixedEventSummaries([
      plan('1', '2026-07-16', '13:00', '14:00', '授業'),
      plan('2', '2026-07-20', '12:00', '13:00', '範囲外'),
    ], range);
    expect(summaries).toEqual(['7/16 13:00〜14:00「授業」']);
  });

  it('asks only for additional events and does not use personal examples', () => {
    const question = fallbackQuestionForSlot('fixed_events', {
      knownFixedEventSummaries: ['7/16 13:00〜14:00「授業」'],
    });
    expect(question).toContain('登録済みの予定は');
    expect(question).toContain('これ以外に');
    expect(question).not.toContain('通院');
  });
});
`);

const plannerTestPath = 'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.test.ts';
let plannerTest = read(plannerTestPath);
const plannerInsert = `\n  it('does not call or display AI-authored event claims for availability actions', async () => {\n    const value = rangeOnlyState();\n    value.missing = ['fixed_events'];\n    const snapshot = createPlanningHypothesisSnapshot({ state: value });\n    const allowedActions = createAllowedDialogueActions(snapshot);\n    const client: OpenAiCompatibleClient = {\n      createChatCompletion: vi.fn(async () => JSON.stringify({\n        acknowledgement: '火曜の通院予定を確認しました。',\n        selectedActionIds: [allowedActions[0]?.actionId],\n        items: [{ actionId: allowedActions[0]?.actionId, text: '火曜の通院予定以外にありますか？' }],\n      })),\n    };\n    const planner = createAiBehaviorAwareWeeklyPlanningDialoguePlanner(config, client);\n    const result = await planner.plan({\n      snapshot,\n      allowedActions,\n      acceptedFacts: {\n        taskLabels: ['英語'],\n        planningPeriodLabel: '今週',\n        constraintSummary: [],\n        knownFixedEventSummaries: ['7/16 13:00〜14:00「授業」'],\n      },\n      previewAllowed: false,\n    });\n\n    expect(client.createChatCompletion).not.toHaveBeenCalled();\n    expect(result.source).toBe('deterministic_fallback');\n    expect(result.message).toContain('7/16 13:00〜14:00「授業」');\n    expect(result.message).not.toContain('通院');\n  });\n`;
const closing = `\n  it('uses a closed top-level response schema', () => {`;
if (!plannerTest.includes(closing)) throw new Error('planner test insertion anchor not found');
plannerTest = plannerTest.replace(closing, plannerInsert + closing);
write(plannerTestPath, plannerTest);

write('src/features/weeklyPlanning/pipeline/weeklyPlanningFixedEventCapability.test.ts', `import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from './weeklyPlanningIntakePipeline';

function plan(id: string, date: string): Plan {
  return {
    id, userId: 'user', date, startTime: '10:00', endTime: '11:00', title: id,
    subject: '', type: 'other', memo: '', repeat: 'none', repeatUntil: null,
    recurrenceRules: [], excludedDates: [], createdAt: '', updatedAt: '',
  } as Plan;
}

function previousState() {
  return {
    ...createInitialPlanningIntakeState(),
    range: {
      startDateTime: '2026-07-16T12:00:00',
      endDateTime: '2026-07-19T18:00:00',
      confidence: 'explicit' as const,
      sourceText: '今週',
    },
  };
}

describe('fixed event source availability', () => {
  it('does not expose existing_plans when every plan is outside the active range', async () => {
    let available = true;
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn(input) {
        available = input.stateSummary.availableConstraintSources?.existingPlans ?? false;
        return { candidates: [], parseRejections: [] };
      },
    };
    await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState: previousState(), userText: '予定を使って', planningStartDate: '2026-07-16',
      planningDayCount: 4, existingPlans: [plan('outside', '2026-07-20')], interpreter,
    });
    expect(available).toBe(false);
  });

  it('exposes existing_plans when a recurring occurrence overlaps the active range', async () => {
    let available = false;
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn(input) {
        available = input.stateSummary.availableConstraintSources?.existingPlans ?? false;
        return { candidates: [], parseRejections: [] };
      },
    };
    const recurring = { ...plan('weekly', '2026-07-09'), repeat: 'weekly' as const, repeatUntil: '2026-08-31' };
    await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState: previousState(), userText: '予定を使って', planningStartDate: '2026-07-16',
      planningDayCount: 4, existingPlans: [recurring], interpreter,
    });
    expect(available).toBe(true);
  });
});
`);

write('docs/ai/tasks/20260716-weekly-planning-grounded-fixed-event-occurrences.md', `# 固定予定を対象期間occurrenceから決定的にgroundingする\n\nStatus: open\nCreated: 2026-07-16\nParent: \`20260716-weekly-planning-conversation-hardening-review-fixes.md\`\n\n## 完了条件\n\n- [ ] exam・non-examの固定予定質問を保存済み予定だけから再構成する\n- [ ] AIのacknowledgementやreasoningに未登録予定を表示しない\n- [ ] planning rangeの開始・終了時刻を考慮する\n- [ ] 繰り返し予定を対象期間occurrenceへ展開する\n- [ ] summaryとconstraint-source availabilityで同じ抽出関数を使う\n- [ ] 範囲外予定だけならexisting_plansを利用不可にする\n- [ ] 回帰テストを追加する\n`);

console.log('weekly planning grounded fixed events applied');
