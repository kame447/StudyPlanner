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
});
