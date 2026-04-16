import { describe, expect, it } from "vitest";
import {
  parseNaturalLanguageSchedule,
  runNaturalLanguagePipeline,
} from "../index";

describe("natural-language integration", () => {
  it("全文を最後まで流して nightly review を1件にまとめられる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。",
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.title).toBe("英単語の復習");
    expect(suggestions[0].parsedPlan.subject).toBe("英語");
    expect(suggestions[0].parsedPlan.startTime).toBe("23:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("23:15");
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "daily",
      startTime: "23:00",
      endTime: "23:15",
    });
  });

  it("base と override を最後まで流して3件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "平日は毎朝7時から30分。ただし火曜と金曜は6時半から。",
    );

    expect(suggestions).toHaveLength(3);

    const base = suggestions[0];
    expect(base.parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "day-type",
      dayType: "weekday",
      startTime: "07:00",
      endTime: "07:30",
    });
    expect(base.parsedPlan.recurrenceRules?.[0].excludedWeekdays?.slice().sort()).toEqual([
      "fri",
      "tue",
    ]);

    const overrideWeekdays = suggestions
      .slice(1)
      .map((suggestion) => suggestion.parsedPlan.recurrenceRules?.[0].weekdays?.[0])
      .sort();

    expect(overrideWeekdays).toEqual(["fri", "tue"]);
  });

  it("デバッグ用に中間結果もまとめて取れる", () => {
    const result = runNaturalLanguagePipeline("毎晩英単語を復習");

    expect(result.normalizedText).toBe("毎晩英単語を復習");
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.clauses).toHaveLength(1);
    expect(result.ast.base).not.toBeNull();
    expect(result.ir.base?.unresolvedFields).toContain("startTime");
    expect(result.ir.base?.unresolvedFields).toContain("endTime");
    expect(result.suggestions).toHaveLength(1);
  });

  it("空文字は空配列で返せる", () => {
    const suggestions = parseNaturalLanguageSchedule("   ");
    expect(suggestions).toEqual([]);
  });
});