import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";

describe("buildAST", () => {
  it("time-only を直前イベントへ attach できる", () => {
    const clauses = parseClauses(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );
    const ast = buildAST(clauses);

    expect(ast.base).not.toBeNull();
    expect(ast.base?.durationSpec?.minutes).toBe(15);

    expect(ast.attachments).toHaveLength(1);
    expect(ast.attachments[0]).toMatchObject({
      kind: "AttachedTime",
      target: "nearest-event",
      rawText: "時間は23:00で",
    });

    expect(
      "hm" in ast.attachments[0].time ? ast.attachments[0].time.hm : null
    ).toBe("23:00");
  });

  it("override を base にぶら下げられる", () => {
    const clauses = parseClauses(
      "平日は毎朝7時から30分。ただし火曜は6時半から。"
    );
    const ast = buildAST(clauses);

    expect(ast.base).not.toBeNull();
    expect(ast.overrides).toHaveLength(1);
    expect(ast.overrides[0].weekdaySpecs?.[0]?.weekday).toBe("tue");

    const replaceTime = ast.overrides[0].replaceTimeSpec;
    expect(replaceTime && "hm" in replaceTime ? replaceTime.hm : null).toBe(
      "06:30"
    );
  });

  it("base がない time-only は diagnostic に落とす", () => {
    const clauses = parseClauses("時間は23時で。");
    const ast = buildAST(clauses);

    expect(ast.base).toBeNull();
    expect(ast.attachments).toHaveLength(0);
    expect(ast.diagnostics[0]?.code).toBe("TIME_ONLY_WITHOUT_BASE");
  });
});
