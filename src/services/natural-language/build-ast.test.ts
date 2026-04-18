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
    const attachment = ast.groups[0].attachments[0];
    expect(attachment).toMatchObject({
      kind: "AttachedTime",
      target: "nearest-event",
      rawText: "時間は23:00で",
    });

    expect(attachment.kind).toBe("AttachedTime");
    const attachedTime = attachment.kind === "AttachedTime" ? attachment.time : undefined;
    expect(
      attachedTime && "hm" in attachedTime
        ? attachedTime.hm
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

  it("1文内の複数明示時間ブロックを別 group に分け、先頭の dateSpec を後続へ引き継げる", () => {
    const clauses = parseClauses(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理をやる"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(3);
    expect(ast.groups[0].base.dateSpec?.kind).toBe("relative-day");
    expect(ast.groups[1].base.dateSpec?.kind).toBe("relative-day");
    expect(ast.groups[2].base.dateSpec?.kind).toBe("relative-day");
    expect(ast.groups[1].base.contentText).toContain("英語長文");
    expect(ast.groups[2].base.contentText).toContain("物理");
  });

  it("shared week-scope head を後続 explicit time block にも引き継げる", () => {
    const clauses = parseClauses(
      "今週の土曜日、9時から11時まで数学、13時から16時まで英語、20時から21時まで復習"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(3);
    expect(ast.groups.every((group) => group.base.dateSpec?.kind === "week-scope")).toBe(
      true
    );
  });

  it("explicit date head を後続 explicit time block にも引き継げる", () => {
    const clauses = parseClauses(
      "4月15日の19時から21時までTOEICの勉強、22時から30分復習"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(2);
    expect(ast.groups[0].base.dateSpec).toMatchObject({
      kind: "explicit-date",
      month: 4,
      day: 15,
    });
    expect(ast.groups[1].base.dateSpec).toMatchObject({
      kind: "explicit-date",
      month: 4,
      day: 15,
    });
  });

  it("補足句 instruction は group を増やさず diagnostic に落とせる", () => {
    const clauses = parseClauses(
      "4月15日の19時から21時までTOEICの勉強を入れて。内容は単語とリスニング。"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.diagnostics.some((diagnostic) => diagnostic.code === "INSTRUCTION_IGNORED")).toBe(
      true
    );
  });

  it("本文 + instruction tail は event 側に残し、内容導入句は別 attachment へ寄せられる", () => {
    const clauses = parseClauses(
      "土日は朝9時から2時間、共通テストの過去問演習を入れて。時間は23時で。"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.contentText).toBe("共通テストの過去問演習");
    expect(ast.groups[0].attachments).toContainEqual(
      expect.objectContaining({
        kind: "AttachedTime",
        rawText: "時間は23:00で",
      })
    );
  });

  it("contentText の先頭末尾ノイズを今回の対象例で落とせる", () => {
    const clauses = parseClauses(
      "今日の9時から11時まで情報の課題。10時から化学を90分。夜は20時から1時間、現代文。"
    );
    const ast = buildAST(clauses);

    expect(ast.groups[0].base.contentText).toBe("情報の課題");
    expect(ast.groups[1].base.contentText).toBe("化学");
    expect(ast.groups[2].base.contentText).toBe("現代文");
  });

  it("title 用の lexical rewrite は持たず、句レベルの content をそのまま残せる", () => {
    const clauses = parseClauses(
      "寝る前にDUO3.0を30分。19時から学校ワークAを進める。20時から期末レポートの考察を書く。"
    );
    const ast = buildAST(clauses);

    expect(ast.groups[0].base.contentText).toBe("DUO3.0");
    expect(ast.groups[1].base.contentText).toBe("学校ワークA");
    expect(ast.groups[2].base.contentText).toBe("期末レポートの考察");
  });

  it("set-count を含む control instruction を直前イベントへ attach できる", () => {
    const clauses = parseClauses(
      "14時から50分勉強して10分休憩、これを3セットで数学にして"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.durationSpec?.minutes).toBe(50);
    expect(ast.groups[0].base.restDurationSpec?.minutes).toBe(10);
    expect(ast.groups[0].attachments).toHaveLength(1);
    expect(ast.groups[0].attachments[0]).toMatchObject({
      kind: "AttachedControl",
      setCount: 3,
      contentText: "数学",
    });
  });

  it("loop cue を持つ control clause は standalone control として切れ、base event を汚さない", () => {
    const clauses = parseClauses(
      "19時から学校ワークAを進める。これを3セットで数学にして"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.contentText).toBe("学校ワークA");
    expect(ast.groups[0].attachments).toContainEqual(
      expect.objectContaining({
        kind: "AttachedControl",
        setCount: 3,
        contentText: "数学",
      })
    );
  });

  it("content span extraction で control phrase や recurrence cue を本文へ漏らさない", () => {
    const clauses = parseClauses(
      "平日7時から30分、これを3セットで学校ワークAにして"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.contentText).toBeUndefined();
    expect(ast.groups[0].attachments).toContainEqual(
      expect.objectContaining({
        kind: "AttachedControl",
        contentText: "学校ワークA",
        setCount: 3,
      }),
    );
  });

  it("control cue を content span へ漏らさず、本文候補だけを残せる", () => {
    const clauses = parseClauses(
      "14時から50分勉強して10分休憩。全部学校ワークAにして"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.contentText).toBe("勉強");
    expect(ast.groups[0].attachments).toContainEqual(
      expect.objectContaining({
        kind: "AttachedControl",
        contentText: "学校ワークA",
      }),
    );
  });

  it("recurrence cue や override cue を含む reverse-order base でも本文だけを残せる", () => {
    const clauses = parseClauses(
      "水曜だけ22時、他の日は毎日20時から21時で勉強予定を入れて"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.contentText).toBe("勉強予定");
    expect(ast.groups[0].base.contentText).not.toContain("他の日は");
    expect(ast.groups[0].base.contentText).not.toContain("毎日");
  });

  it("clean に取れない control-only span は unsafe content として採用しない", () => {
    const clauses = parseClauses("毎日20時から30分、全部ずつにして");
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.contentText).toBeUndefined();
    expect(ast.groups[0].attachments).toHaveLength(0);
  });

  it("reverse-order override は pending override として保持し、後続 base へぶら下げられる", () => {
    const clauses = parseClauses(
      "水曜だけ22時、他の日は毎日20時から21時で勉強予定を入れて"
    );
    const ast = buildAST(clauses);

    expect(ast.groups).toHaveLength(1);
    expect(ast.groups[0].base.rawText).toContain("他の日は");
    expect(ast.groups[0].overrides).toHaveLength(1);
    expect(ast.groups[0].overrides[0].weekdaySpecs?.map((weekday) => weekday.weekday)).toEqual([
      "wed",
    ]);
  });
});
