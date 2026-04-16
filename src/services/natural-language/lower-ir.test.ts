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

    expect(ir.base).toBeDefined();
    expect(ir.base?.startTime).toBe("23:00");
    expect(ir.base?.endTime).toBe("23:15");
    expect(ir.base?.durationMinutes).toBe(15);
    expect(ir.base?.assumptions).toContain("time-only attached");
    expect(ir.overrideIntents).toHaveLength(0);
  });

  it("override を曜日ごとに分解し、duration を継承できる", () => {
    const clauses = parseClauses(
      "平日は毎朝7時から30分。ただし火曜と金曜は6時半から。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast);

    expect(ir.base).toBeDefined();
    expect(ir.base?.dayType).toBe("weekday");
    expect(ir.base?.startTime).toBe("07:00");
    expect(ir.base?.endTime).toBe("07:30");
    expect(ir.base?.excludedWeekdays?.slice().sort()).toEqual(["fri", "tue"]);

    expect(ir.overrideIntents).toHaveLength(2);
    expect(
      ir.overrideIntents.map((override) => override.weekdays?.[0]).sort()
    ).toEqual(["fri", "tue"]);

    for (const override of ir.overrideIntents) {
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

    expect(ir.base).toBeDefined();
    expect(ir.base?.startTime).toBeUndefined();
    expect(ir.base?.endTime).toBeUndefined();
    expect(ir.base?.unresolvedFields).toContain("startTime");
    expect(ir.base?.unresolvedFields).toContain("endTime");
  });
});
