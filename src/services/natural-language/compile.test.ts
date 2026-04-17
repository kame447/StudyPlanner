import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";
import { compileToSuggestions } from "./compile";
import { lowerToIR } from "./lower-ir";
import type { Suggestion } from "./shared/types";

describe("compileToSuggestions", () => {
  it("time-only attach を含む daily の suggestion を作れる", () => {
    const clauses = parseClauses(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);
    const suggestions = compileToSuggestions(ir);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.startTime).toBe("23:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("23:15");
    expect(suggestions[0].parsedPlan.subject).toBe("英語");
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "daily",
      startTime: "23:00",
      endTime: "23:15",
    });
    expect(suggestions[0].assumptions).toContain("time-only attached");
  });

  it("base と override を suggestion 群に compile できる", () => {
    const clauses = parseClauses(
      "平日は毎朝7時から30分。ただし火曜と金曜は6時半から。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);
    const suggestions = compileToSuggestions(ir);

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

    for (const suggestion of suggestions.slice(1)) {
      expect(suggestion.parsedPlan.startTime).toBe("06:30");
      expect(suggestion.parsedPlan.endTime).toBe("07:00");
      expect(suggestion.assumptions).toContain("duration inherited from base");
    }
  });

  it("未確定時間を unresolvedFields に残せる", () => {
    const clauses = parseClauses("毎晩英単語を復習");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);
    const suggestions = compileToSuggestions(ir);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].unresolvedFields).toContain("startTime");
    expect(suggestions[0].unresolvedFields).toContain("endTime");
  });

  it("relative ordering を date ごと compile できる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。そのあと英単語を30分"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

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

  it("enumeration を 3 件の suggestion に展開できる", () => {
    const clauses = parseClauses(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

    expect(suggestions).toHaveLength(3);
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.title)
    ).toEqual(["長文", "単語", "文法"]);
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.subject)
    ).toEqual(["英語", "英語", "英語"]);
    expect(suggestions[0].parsedPlan.dateSpec?.kind).toBe("week-scope");
    expect(
      suggestions.every((suggestion: Suggestion) =>
        suggestion.assumptions.includes("enumeration expanded from base")
      )
    ).toBe(true);
  });

  it("独立イベントを 2 件の suggestion に compile できる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。明後日20時から英語を30分"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[0].parsedPlan.subject).toBe("数学");
    expect(suggestions[1].parsedPlan.date).toBe("2026-04-18");
    expect(suggestions[1].parsedPlan.subject).toBe("英語");
  });

  it("1文内の複数明示時間ブロックを複数 suggestion に compile できる", () => {
    const clauses = parseClauses(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理をやる"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

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
  });

  it("contentText 由来の title が先頭末尾ノイズを含まない", () => {
    const clauses = parseClauses(
      "明日の7時から30分システム英単語、そのあと8時から9時半まで青チャート。夜は20時から1時間、現代文。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

    expect(suggestions[0].parsedPlan.title).toBe("システム英単語");
    expect(suggestions[1].parsedPlan.title).toBe("青チャート");
    expect(suggestions[2].parsedPlan.title).toBe("現代文");
  });

  it("subject 推定の局所ルールが情報/物理/国語/演習を優先しつつ既存の英語/数学を壊さない", () => {
    const clauses = parseClauses(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理。朝8時から30分システム英単語、9時から11時まで良問の風、夜は22時から20分古文単語315。土日は朝9時から2時間、共通テストの過去問演習。20時から復習。21時から振り返り。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "情報",
      "英語",
      "物理",
      "英語",
      "物理",
      "国語",
      "演習",
      "復習",
      "振り返り",
    ]);
  });

  it("unknown な教材名や課題名でも全文 fallback ではなく lexical candidate を title にできる", () => {
    const clauses = parseClauses(
      "寝る前にDUO3.0を30分。19時から学校ワークAを進める。20時から期末レポートの考察を書く。21時からWeb開発課題の修正。22時から統計学小テストの見直し。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });
    const suggestions = compileToSuggestions(ir);

    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "DUO3.0",
      "学校ワークA",
      "期末レポートの考察",
      "Web開発課題の修正",
      "統計学小テストの見直し",
    ]);
  });
});
