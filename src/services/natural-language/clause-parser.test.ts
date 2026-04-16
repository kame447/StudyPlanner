import { describe, expect, it } from "vitest";
import { parseClauses } from "./clause-parser";

describe("parseClauses", () => {
  it("予定本体と time-only を分けられる", () => {
    const clauses = parseClauses(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );

    expect(clauses.map((clause) => clause.kind)).toEqual([
      "EventClause",
      "TimeOnlyClause",
    ]);
  });

  it("override 句を分けられる", () => {
    const clauses = parseClauses(
      "平日は毎朝7時から30分。ただし火曜は6時半から。"
    );

    expect(clauses.map((clause) => clause.kind)).toEqual([
      "EventClause",
      "OverrideClause",
    ]);
  });

  it("構造がない文は InstructionClause に落とせる", () => {
    const clauses = parseClauses("メモしておいて");

    expect(clauses.map((clause) => clause.kind)).toEqual(["InstructionClause"]);
  });
});
