import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";
import { compileToSuggestions } from "./compile";
import { lowerToIR } from "./lower-ir";
import { validateAndDedupe } from "./validate";
import type { Suggestion } from "./shared/types";

describe("validateAndDedupe", () => {
  it("通常の compile 結果をそのまま通せる", () => {
    const clauses = parseClauses(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);
    const suggestions = compileToSuggestions(ir);
    const validated = validateAndDedupe(suggestions);

    expect(validated).toHaveLength(1);
    expect(validated[0].parsedPlan.startTime).toBe("23:00");
    expect(validated[0].parsedPlan.endTime).toBe("23:15");
  });

  it("startTime と endTime が同じ無意味候補を落とせる", () => {
    const invalid: Suggestion = {
      rawText: "ダミー",
      parsedPlan: {
        rawText: "ダミー",
        title: "ダミー",
        startTime: "00:00",
        endTime: "00:00",
      },
      assumptions: [],
      unresolvedFields: [],
      confidence: 0.5,
    };

    const validated = validateAndDedupe([invalid]);
    expect(validated).toHaveLength(0);
  });

  it("同一内容の重複候補があれば強い方を残せる", () => {
    const weaker: Suggestion = {
      rawText: "毎晩英単語",
      parsedPlan: {
        rawText: "毎晩英単語",
        contentText: "英単語",
        startTime: "23:00",
        endTime: "23:15",
      },
      assumptions: [],
      unresolvedFields: ["title", "subject"],
      confidence: 0.4,
    };

    const stronger: Suggestion = {
      rawText: "毎晩英単語",
      parsedPlan: {
        rawText: "毎晩英単語",
        title: "英単語の復習",
        subject: "英語",
        contentText: "英単語",
        startTime: "23:00",
        endTime: "23:15",
        recurrenceRules: [
          {
            kind: "daily",
            startTime: "23:00",
            endTime: "23:15",
          },
        ],
      },
      assumptions: ["time-only attached"],
      unresolvedFields: [],
      confidence: 0.9,
    };

    const validated = validateAndDedupe([weaker, stronger]);
    expect(validated).toHaveLength(1);
    expect(validated[0].parsedPlan.title).toBe("英単語の復習");
    expect(validated[0].parsedPlan.subject).toBe("英語");
    expect(validated[0].parsedPlan.recurrenceRules?.[0].kind).toBe("daily");
  });
});
