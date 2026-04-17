import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";
import { lowerToIR } from "./lower-ir";

describe("lowerToIR", () => {
  it("time-only attach を base の start/end に反映できる", () => {
    const clauses = parseClauses(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.startTime).toBe("23:00");
    expect(ir.groups[0].base.endTime).toBe("23:15");
    expect(ir.groups[0].base.durationMinutes).toBe(15);
    expect(ir.groups[0].base.assumptions).toContain("time-only attached");
    expect(ir.groups[0].overrideIntents).toHaveLength(0);
  });

  it("override を曜日ごとに分解し、duration を継承できる", () => {
    const clauses = parseClauses(
      "平日は毎朝7時から30分。ただし火曜と金曜は6時半から。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.dayType).toBe("weekday");
    expect(ir.groups[0].base.startTime).toBe("07:00");
    expect(ir.groups[0].base.endTime).toBe("07:30");
    expect(ir.groups[0].base.excludedWeekdays?.slice().sort()).toEqual([
      "fri",
      "tue",
    ]);

    expect(ir.groups[0].overrideIntents).toHaveLength(2);
    expect(
      ir.groups[0].overrideIntents
        .map((override) => override.weekdays?.[0])
        .sort()
    ).toEqual(["fri", "tue"]);

    for (const override of ir.groups[0].overrideIntents) {
      expect(override.startTime).toBe("06:30");
      expect(override.endTime).toBe("07:00");
      expect(override.durationMinutes).toBe(30);
      expect(override.assumptions).toContain("duration inherited from base");
    }
  });

  it("時間がない base は unresolvedFields に残せる", () => {
    const clauses = parseClauses("毎晩英単語を復習");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.startTime).toBeUndefined();
    expect(ir.groups[0].base.endTime).toBeUndefined();
    expect(ir.groups[0].base.unresolvedFields).toContain("startTime");
    expect(ir.groups[0].base.unresolvedFields).toContain("endTime");
  });

  it("relative day を referenceDate 基準で解決できる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。そのあと英単語を30分"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-17");
    expect(ir.groups[0].base.startTime).toBe("19:00");
    expect(ir.groups[0].base.endTime).toBe("20:00");

    expect(ir.groups[0].sequencedIntents).toHaveLength(1);
    expect(ir.groups[0].sequencedIntents[0].date).toBe("2026-04-17");
    expect(ir.groups[0].sequencedIntents[0].startTime).toBe("20:00");
    expect(ir.groups[0].sequencedIntents[0].endTime).toBe("20:30");
    expect(ir.groups[0].sequencedIntents[0].assumptions).toContain(
      "date inherited from previous event"
    );
    expect(ir.groups[0].sequencedIntents[0].assumptions).toContain(
      "anchored to previous event endTime"
    );
  });

  it("enumeration を 3 つの enumeratedIntents に落とせる", () => {
    const clauses = parseClauses(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].enumeratedIntents).toHaveLength(3);
    expect(
      ir.groups[0].enumeratedIntents.map((item) => item.contentText)
    ).toEqual(["長文", "単語", "文法"]);
    expect(ir.groups[0].enumeratedIntents[0].dateSpec?.kind).toBe("week-scope");
    expect(ir.groups[0].enumeratedIntents[0].unresolvedFields).toContain(
      "date"
    );
  });

  it("独立したイベントを複数 group の IR に落とせる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。明後日20時から英語を30分"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(2);
    expect(ir.groups[0].base.date).toBe("2026-04-17");
    expect(ir.groups[0].base.startTime).toBe("19:00");
    expect(ir.groups[1].base.date).toBe("2026-04-18");
    expect(ir.groups[1].base.startTime).toBe("20:00");
  });
});
