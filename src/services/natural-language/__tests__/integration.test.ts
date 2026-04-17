import { describe, expect, it } from "vitest";
import {
  parseNaturalLanguageSchedule,
  runNaturalLanguagePipeline,
} from "../index";
import type { Suggestion } from "../shared/types";

describe("natural-language integration", () => {
  it("全文を最後まで流して nightly review を1件にまとめられる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
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
      "平日は毎朝7時から30分。ただし火曜と金曜は6時半から。"
    );

    expect(suggestions).toHaveLength(3);

    const base = suggestions[0];
    expect(base.parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "day-type",
      dayType: "weekday",
      startTime: "07:00",
      endTime: "07:30",
    });
    expect(
      base.parsedPlan.recurrenceRules?.[0].excludedWeekdays?.slice().sort()
    ).toEqual(["fri", "tue"]);

    const overrideWeekdays = suggestions
      .slice(1)
      .map(
        (suggestion: Suggestion) =>
          suggestion.parsedPlan.recurrenceRules?.[0].weekdays?.[0]
      )
      .sort();

    expect(overrideWeekdays).toEqual(["fri", "tue"]);
  });

  it("relative ordering を日付つきで最後まで流して2件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日19時から数学を1時間。そのあと英単語を30分",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(2);

    expect(suggestions[0].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[0].parsedPlan.startTime).toBe("19:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("20:00");
    expect(suggestions[0].parsedPlan.subject).toBe("数学");

    expect(suggestions[1].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[1].parsedPlan.startTime).toBe("20:00");
    expect(suggestions[1].parsedPlan.endTime).toBe("20:30");
    expect(suggestions[1].parsedPlan.subject).toBe("英語");
    expect(suggestions[1].assumptions).toContain(
      "date inherited from previous event"
    );
    expect(suggestions[1].assumptions).toContain(
      "anchored to previous event endTime"
    );
  });

  it("enumeration を最後まで流して3件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.title)
    ).toEqual(["長文", "単語", "文法"]);
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.subject)
    ).toEqual(["英語", "英語", "英語"]);
    expect(suggestions[0].parsedPlan.dateSpec?.kind).toBe("week-scope");
    expect(suggestions[0].unresolvedFields).toContain("date");
  });

  it("独立したイベントを最後まで流して2件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日19時から数学を1時間。明後日20時から英語を30分",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[0].parsedPlan.subject).toBe("数学");
    expect(suggestions[1].parsedPlan.date).toBe("2026-04-18");
    expect(suggestions[1].parsedPlan.subject).toBe("英語");
  });

  it("1文内の複数明示時間ブロックを複数 suggestion として抽出できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理をやる。",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-16");
    expect(suggestions[0].parsedPlan.startTime).toBe("09:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("11:00");
    expect(suggestions[1].parsedPlan.date).toBe("2026-04-16");
    expect(suggestions[1].parsedPlan.startTime).toBe("13:00");
    expect(suggestions[1].parsedPlan.endTime).toBe("14:00");
    expect(suggestions[2].parsedPlan.date).toBe("2026-04-16");
    expect(suggestions[2].parsedPlan.startTime).toBe("15:00");
    expect(suggestions[2].parsedPlan.endTime).toBe("16:30");
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "情報の課題",
      "英語長文",
      "物理",
    ]);
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "のまで情報の課題")).toBe(
      false
    );
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "まで物理をやる")).toBe(
      false
    );
  });

  it("1文内の複数明示時間ブロックでも相対順序テストを壊さない", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "9時から10時まで英語、10分休憩して、10時10分から11時40分まで数学、13時から14時まで物理",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].parsedPlan.startTime).toBe("09:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("10:00");
    expect(suggestions[1].parsedPlan.startTime).toBe("10:10");
    expect(suggestions[1].parsedPlan.endTime).toBe("11:40");
    expect(suggestions[2].parsedPlan.startTime).toBe("13:00");
    expect(suggestions[2].parsedPlan.endTime).toBe("14:00");
  });

  it("補足句は standalone な suggestion にせず、主イベントだけ残せる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "4月15日の19時から21時までTOEICの勉強を入れて。内容は単語とリスニング。"
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.startTime).toBe("19:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("21:00");
  });

  it("複数明示時間ブロックでも title が青チャート / 現代文に汚れず残る", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日の7時から30分システム英単語、そのあと8時から9時半まで青チャート。夜は20時から1時間、現代文。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "システム英単語",
      "青チャート",
      "現代文",
    ]);
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "まで青チャート")).toBe(
      false
    );
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "夜はから現代文")).toBe(
      false
    );
  });

  it("relative ordering を壊さず title の前後ノイズを落とせる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "10時から化学を90分、そのあと30分休んで、12時から1時間英語をやる。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "化学",
      "英語",
    ]);
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "から化学を")).toBe(
      false
    );
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "から英語をやる")).toBe(
      false
    );
    expect(suggestions[0].parsedPlan.startTime).toBe("10:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("11:30");
    expect(suggestions[1].parsedPlan.startTime).toBe("12:00");
    expect(suggestions[1].parsedPlan.endTime).toBe("13:00");
  });

  it("デバッグ用に中間結果もまとめて取れる", () => {
    const result = runNaturalLanguagePipeline("毎晩英単語を復習");

    expect(result.normalizedText).toBe("毎晩英単語を復習");
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.clauses).toHaveLength(1);
    expect(result.ast.groups).toHaveLength(1);
    expect(result.ir.groups[0].base.unresolvedFields).toContain("startTime");
    expect(result.ir.groups[0].base.unresolvedFields).toContain("endTime");
    expect(result.suggestions).toHaveLength(1);
  });

  it("空文字は空配列で返せる", () => {
    const suggestions = parseNaturalLanguageSchedule("   ");
    expect(suggestions).toEqual([]);
  });
});
