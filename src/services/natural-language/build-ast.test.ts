import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";

describe("buildAST", () => {
  it("time-only を直前イベントへ attach できる", () => {
    const clauses = parseClauses(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.durationSpec?.minutes).toBe(15);

    expect(ast.groups[0].attachments).toHaveLength(1);
    expect(ast.groups[0].attachments[0]).toMatchObject({
      kind: "AttachedTime",
      target: "nearest-event",
      rawText: "時間は23:00で",
    });

    expect(
      "hm" in ast.groups[0].attachments[0].time
        ? ast.groups[0].attachments[0].time.hm
        : null
    ).toBe("23:00");
  });

  it("override を base にぶら下げられる", () => {
    const clauses = parseClauses(
      "平日は毎朝7時から30分。ただし火曜は6時半から。"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].overrides).toHaveLength(1);
    expect(ast.groups[0].overrides[0].weekdaySpecs?.[0]?.weekday).toBe("tue");

    const replaceTime = ast.groups[0].overrides[0].replaceTimeSpec;
    expect(replaceTime && "hm" in replaceTime ? replaceTime.hm : null).toBe(
      "06:30"
    );
  });

  it("base がない time-only は diagnostic に落とす", () => {
    const clauses = parseClauses("時間は23時で。");
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(0);
    expect(ast.diagnostics[0]?.code).toBe("TIME_ONLY_WITHOUT_BASE");
  });

  it("そのあと句を previous-event 依存の sequence として保持できる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。そのあと英単語を30分"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.dateSpec?.kind).toBe("relative-day");
    expect(ast.groups[0].base.durationSpec?.minutes).toBe(60);

    expect(ast.groups[0].sequences).toHaveLength(1);
    expect(ast.groups[0].sequences[0].relation.kind).toBe(
      "after-previous-event"
    );
    expect(ast.groups[0].sequences[0].relation.rawText).toBe("そのあと");
    expect(ast.groups[0].sequences[0].durationSpec?.minutes).toBe(30);
    expect(ast.groups[0].sequences[0].contentText).toContain("英単語");
  });

  it("enumeration 句を 3 つの variant に分解できる", () => {
    const clauses = parseClauses(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.dateSpec?.kind).toBe("week-scope");
    expect(ast.groups[0].enumerations).toHaveLength(3);
    expect(
      ast.groups[0].enumerations.map((variant) => variant.contentText)
    ).toEqual(["長文", "単語", "文法"]);
  });

  it("独立したイベントを別 group に分けられる", () => {
    const clauses = parseClauses(
      "明日19時から数学を1時間。明後日20時から英語を30分"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(2);
    expect(ast.groups[0].base.contentText).toContain("数学");
    expect(ast.groups[1].base.contentText).toContain("英語");
  });
});
