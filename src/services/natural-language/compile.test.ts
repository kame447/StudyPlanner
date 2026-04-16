import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";
import { compileToSuggestions } from "./compile";
import { lowerToIR } from "./lower-ir";

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
        (suggestion) => suggestion.parsedPlan.recurrenceRules?.[0].weekdays?.[0]
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
});
