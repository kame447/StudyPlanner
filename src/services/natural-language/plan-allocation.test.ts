import { describe, expect, it } from "vitest";
import { allocatePlanningIntent } from "./plan-allocation";
import type { PlanningIntent } from "./shared/types";
import type { Plan } from "../../types/domain";

function buildPlan(overrides: Partial<Plan>): Plan {
  return {
    id: "plan-1",
    seriesId: "series-1",
    userId: "user-1",
    title: "既存予定",
    subject: "既存",
    date: "2026-04-12",
    startTime: "20:00",
    endTime: "21:00",
    repeat: "none",
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: "study",
    memo: "",
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("allocatePlanningIntent", () => {
  it("count-limited grouped planning を concrete suggestions に割り当てる", () => {
    const intent: PlanningIntent = {
      kind: "count-limited-recurrence",
      rawText: "来週のどこかで英語を3回入れて",
      tasks: [
        {
          title: "英語長文",
          subject: "英語",
          sessionCount: 3,
          sessionMinutes: 60,
          preferredStartTime: "20:00",
        },
      ],
      window: {
        startDate: "2026-04-12",
        endDate: "2026-04-18",
      },
      nonOverlap: true,
      assumptions: [],
      unresolvedFields: [],
    };

    const suggestions = allocatePlanningIntent({
      intent,
      existingPlans: [buildPlan({})],
      selectedDate: "2026-04-12",
      userId: "user-1",
    });

    expect(suggestions).toHaveLength(3);
    expect(
      suggestions.some(
        (suggestion) =>
          suggestion.parsedPlan.date === "2026-04-12" &&
          suggestion.parsedPlan.startTime === "20:00",
      ),
    ).toBe(false);

    for (const suggestion of suggestions) {
      expect(suggestion.source).toBe("rules");
      expect(suggestion.parsedPlan.repeat).toBe("none");
      expect(suggestion.parsedPlan.recurrenceRules).toEqual([]);
      expect(suggestion.parsedPlan.title).toBe("英語長文");
      expect(suggestion.parsedPlan.subject).toBe("英語");
    }
  });

  it("totalMinutes を sessionMinutes で分割して non-overlap の日別枠に落とす", () => {
    const intent: PlanningIntent = {
      kind: "grouped-allocation",
      rawText: "今週は数学を合計2時間、毎日の予定に割り振って",
      tasks: [
        {
          title: "数学",
          subject: "数学",
          totalMinutes: 120,
          sessionMinutes: 60,
          preferredStartTime: "20:00",
        },
      ],
      window: {
        startDate: "2026-04-12",
        endDate: "2026-04-18",
      },
      nonOverlap: true,
      assumptions: [],
      unresolvedFields: [],
    };

    const suggestions = allocatePlanningIntent({
      intent,
      existingPlans: [],
      selectedDate: "2026-04-12",
      userId: "user-1",
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.date)).toEqual([
      "2026-04-12",
      "2026-04-13",
    ]);
    expect(
      suggestions.map((suggestion) => [
        suggestion.parsedPlan.startTime,
        suggestion.parsedPlan.endTime,
      ]),
    ).toEqual([
      ["20:00", "21:00"],
      ["20:00", "21:00"],
    ]);
  });
});
