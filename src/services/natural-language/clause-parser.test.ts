import { describe, expect, it } from "vitest";
import { parseClauses } from "./clause-parser";

describe("parseClauses", () => {
  it("1文内の複数明示時間ブロックを複数 clause に分けられる", () => {
    const clauses = parseClauses(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理をやる"
    );

    expect(clauses).toHaveLength(3);
    expect(clauses.every((clause) => clause.kind === "EventClause")).toBe(true);
    expect(clauses[0].spanText).toContain("今日の09:00から11:00まで");
    expect(clauses[1].spanText).toBe("13:00から14:00まで英語長文");
    expect(clauses[2].spanText).toBe("15:00から16:30まで物理をやる");
    expect(clauses.map((clause) => clause.sentenceIndex)).toEqual([0, 0, 0]);
  });

  it("休憩句は standalone instruction として切り出し、後続の明示時間ブロックを潰さない", () => {
    const clauses = parseClauses(
      "9時から10時まで英語、10分休憩して、10時10分から11時40分まで数学、13時から14時まで物理"
    );

    expect(clauses).toHaveLength(4);
    expect(clauses[0].kind).toBe("EventClause");
    expect(clauses[1].kind).toBe("InstructionClause");
    expect(clauses[1].spanText).toBe("10分休憩して");
    expect(clauses[2].kind).toBe("EventClause");
    expect(clauses[3].kind).toBe("EventClause");
  });

  it("時刻付き base の後ろにある内容継続句は同一 clause に保てる", () => {
    const clauses = parseClauses(
      "夜は20時から1時間、現代文"
    );

    expect(clauses).toHaveLength(1);
    expect(clauses[0].kind).toBe("EventClause");
    expect(clauses[0].spanText).toContain("現代文");
  });

  it("scope-only な日付句は後続の明示時間ブロックへ結合し、standalone event にしない", () => {
    const clauses = parseClauses("今週の土曜日、9時から11時まで数学");

    expect(clauses).toHaveLength(1);
    expect(clauses[0].kind).toBe("EventClause");
    expect(clauses[0].spanText).toContain("今週の土曜日");
    expect(clauses[0].spanText).toContain("09:00から11:00まで数学");
  });

  it("enumeration の後ろにある time-only scope は別 clause に分けて attach 可能にする", () => {
    const clauses = parseClauses(
      "1回は長文、1回は単語、もう1回は文法で、全部20時から1時間"
    );

    expect(clauses).toHaveLength(2);
    expect(clauses[0].kind).toBe("EnumerationClause");
    expect(clauses[1].kind).toBe("TimeOnlyClause");
  });

  it("内容は〜 の補足句は instruction として扱える", () => {
    const clauses = parseClauses(
      "4月15日の19時から21時までTOEICの勉強を入れて。内容は単語とリスニング。"
    );

    expect(clauses).toHaveLength(2);
    expect(clauses[0].kind).toBe("EventClause");
    expect(clauses[1].kind).toBe("InstructionClause");
    expect(clauses[1].spanText).toBe("内容は単語とリスニング");
  });

  it("合計時間だけの補足句は instruction として扱える", () => {
    const clauses = parseClauses("合計10時間");

    expect(clauses).toHaveLength(1);
    expect(clauses[0].kind).toBe("InstructionClause");
  });

  it("〜として固定して の補足句は standalone event にしない", () => {
    const clauses = parseClauses("自習時間として固定して");

    expect(clauses).toHaveLength(1);
    expect(clauses[0].kind).toBe("InstructionClause");
  });

  it("set-count を含む control 句は直前イベントと分離して instruction にできる", () => {
    const clauses = parseClauses(
      "14時から50分勉強して10分休憩、これを3セットで数学にして"
    );

    expect(clauses).toHaveLength(2);
    expect(clauses[0].kind).toBe("EventClause");
    expect(clauses[0].spanText).toBe("14:00から50分勉強して10分休憩");
    expect(clauses[1].kind).toBe("InstructionClause");
    expect(clauses[1].spanText).toBe("これを3セットで数学にして");
  });

  it("意味のある内容を含む time + control 句は time-only に落とさない", () => {
    const clauses = parseClauses("英語を20時開始にして");

    expect(clauses).toHaveLength(1);
    expect(clauses[0].kind).toBe("EventClause");
  });
});
