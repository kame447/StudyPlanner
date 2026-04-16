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

  it("そのあと句も EventClause として保持できる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。そのあと英単語を30分"
    );

    expect(clauses.map((clause) => clause.kind)).toEqual([
      "EventClause",
      "EventClause",
    ]);
    expect(clauses[1].tokens.some((token) => token.kind === "CONNECTIVE")).toBe(
      true
    );
  });

  it("enumeration 句を EventClause + EnumerationClause に分けられる", () => {
    const clauses = parseClauses(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法"
    );

    expect(clauses.map((clause) => clause.kind)).toEqual([
      "EventClause",
      "EnumerationClause",
    ]);
  });
});
