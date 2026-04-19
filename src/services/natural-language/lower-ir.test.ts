import { describe, expect, it } from "vitest";
import { buildAST } from "./build-ast";
import { parseClauses } from "./clause-parser";
import { lowerToIR } from "./lower-ir";
import type { ScheduleAST } from "./shared/types";

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

  it("referenceDate を YYYY/M/D 形式でも正規化して relative day を解決できる", () => {
    const clauses = parseClauses("明日19時から数学を1時間");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026/4/16" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-17");
  });

  it("今日 / 明日 / 明後日 を concrete date に解決できる", () => {
    const clauses = parseClauses(
      "今日19時から数学を1時間。明日20時から英語を30分。明後日21時から物理を45分"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(3);
    expect(ir.groups.map((group) => group.base.date)).toEqual([
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
    ]);
  });

  it("explicit date と week-scope + weekday を concrete date に解決できる", () => {
    const explicitClauses = parseClauses("4月15日19時から自習を2時間");
    const explicitAst = buildAST(explicitClauses);
    const explicitIr = lowerToIR(explicitAst, { referenceDate: "2026-04-12" });

    expect(explicitIr.groups[0].base.date).toBe("2026-04-15");

    const scopedClauses = parseClauses("今週の土曜日9時から過去問を2時間");
    const scopedAst = buildAST(scopedClauses);
    const scopedIr = lowerToIR(scopedAst, { referenceDate: "2026-04-16" });

    expect(scopedIr.groups[0].base.date).toBe("2026-04-18");
    expect(scopedIr.groups[0].base.assumptions).toContain(
      "representative date derived from scoped weekday"
    );
  });

  it("予定入力では this-week scoped weekday を過去側ではなく直近未来側へ解決できる", () => {
    const clauses = parseClauses("今週の土曜日9時から過去問を2時間");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-18");
    expect(ir.groups[0].base.dateSpec?.kind).toBe("week-scope");
    expect(ir.groups[0].base.assumptions).toContain(
      "representative date derived from scoped weekday"
    );
  });

  it("week-scope representative date を会話当日に潰さずに解決できる", () => {
    const thisWeekClauses = parseClauses("今週のどこかで英語を1時間");
    const thisWeekAst = buildAST(thisWeekClauses);
    const thisWeekIr = lowerToIR(thisWeekAst, { referenceDate: "2026-04-16" });

    expect(thisWeekIr.groups).toHaveLength(1);
    expect(thisWeekIr.groups[0].base.date).toBe("2026-04-17");
    expect(thisWeekIr.groups[0].base.assumptions).toContain(
      "representative date derived from date scope"
    );

    const nextWeekClauses = parseClauses("来週のどこかで数学を1時間");
    const nextWeekAst = buildAST(nextWeekClauses);
    const nextWeekIr = lowerToIR(nextWeekAst, { referenceDate: "2026-04-16" });

    expect(nextWeekIr.groups).toHaveLength(1);
    expect(nextWeekIr.groups[0].base.date).toBe("2026-04-20");
  });

  it("month-scope を in-scope first occurrence の representative date に解決できる", () => {
    const clauses = parseClauses("4月中の平日7時から30分英語");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-18" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-20");
    expect(ir.groups[0].base.assumptions).toContain(
      "representative date derived from month scope"
    );
  });

  it("explicit until recurring を lower-ir で representative date と until に分離できる", () => {
    const clauses = parseClauses("4月19日まで毎日18時から20時英語");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-17");
    expect(ir.groups[0].base.dateSpec).toBeUndefined();
    expect(ir.groups[0].base.untilDate).toBe("2026-04-19");
    expect(ir.groups[0].base.untilSpec?.kind).toBe("explicit-until");
    expect(ir.groups[0].base.repeatSpec?.kind).toBe("daily");
    expect(ir.groups[0].base.startTime).toBe("18:00");
    expect(ir.groups[0].base.endTime).toBe("20:00");
    expect(ir.groups[0].base.assumptions).toContain(
      "representative date derived from explicit until"
    );
  });

  it("month-scope base の weekday override が base recurrence の date window を継承できる", () => {
    const clauses = parseClauses(
      "4月中は毎朝6時半から30分英語、その代わり土曜だけ8時から30分"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-16");
    expect(ir.groups[0].base.untilDate).toBe("2026-04-30");
    expect(ir.groups[0].base.repeatSpec?.kind).toBe("daily");
    expect(ir.groups[0].base.excludedWeekdays).toEqual(["sat"]);
    expect(ir.groups[0].overrideIntents).toHaveLength(1);
    expect(ir.groups[0].overrideIntents[0].date).toBe("2026-04-18");
    expect(ir.groups[0].overrideIntents[0].dateSpec?.kind).toBe("month-scope");
    expect(ir.groups[0].overrideIntents[0].untilDate).toBe("2026-04-30");
    expect(ir.groups[0].overrideIntents[0].weekdays).toEqual(["sat"]);
    expect(ir.groups[0].overrideIntents[0].assumptions).toContain(
      "date window inherited from base recurrence"
    );
  });

  it("month-scope recurring base の representative date を月内 referenceDate に固定できる", () => {
    const clauses = parseClauses(
      "4月中は毎朝6時半から英語を30分、その代わり土曜だけは8時開始にして"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-12");
    expect(ir.groups[0].base.repeatSpec?.kind).toBe("daily");
    expect(ir.groups[0].base.excludedWeekdays).toEqual(["sat"]);
    expect(ir.groups[0].overrideIntents[0].date).toBe("2026-04-18");
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
    expect(
      ir.groups[0].enumeratedIntents.map((item) => item.date)
    ).toEqual(["2026-04-20", "2026-04-21", "2026-04-22"]);
    expect(ir.groups[0].enumeratedIntents[0].unresolvedFields).not.toContain(
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

  it("1文内の複数明示時間ブロックを複数 group に落とし、date を継承できる", () => {
    const clauses = parseClauses(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理をやる"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(3);
    expect(ir.groups[0].base.date).toBe("2026-04-16");
    expect(ir.groups[1].base.date).toBe("2026-04-16");
    expect(ir.groups[2].base.date).toBe("2026-04-16");
    expect(ir.groups[1].base.startTime).toBe("13:00");
    expect(ir.groups[1].base.endTime).toBe("14:00");
    expect(ir.groups[2].base.startTime).toBe("15:00");
    expect(ir.groups[2].base.endTime).toBe("16:30");
  });

  it("cross-midnight な previous event のあとに続く sequence を翌日に rollover できる", () => {
    const clauses = parseClauses(
      "今日23時から1時間情報のレポート。そのあと0時15分から30分英単語"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-12");
    expect(ir.groups[0].base.startTime).toBe("23:00");
    expect(ir.groups[0].base.endTime).toBe("00:00");
    expect(ir.groups[0].sequencedIntents).toHaveLength(1);
    expect(ir.groups[0].sequencedIntents[0].date).toBe("2026-04-13");
    expect(ir.groups[0].sequencedIntents[0].startTime).toBe("00:15");
    expect(ir.groups[0].sequencedIntents[0].endTime).toBe("00:45");
    expect(ir.groups[0].sequencedIntents[0].assumptions).toContain(
      "rolled over to next day after cross-midnight previous event"
    );
  });

  it("previous event 自体が日跨ぎでなくても sequence start が巻き戻る場合は翌日に rollover できる", () => {
    const clauses = parseClauses(
      "今日22時から1時間情報のレポート。そのあと0時15分から30分英単語"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-12");
    expect(ir.groups[0].base.startTime).toBe("22:00");
    expect(ir.groups[0].base.endTime).toBe("23:00");
    expect(ir.groups[0].sequencedIntents).toHaveLength(1);
    expect(ir.groups[0].sequencedIntents[0].date).toBe("2026-04-13");
    expect(ir.groups[0].sequencedIntents[0].startTime).toBe("00:15");
    expect(ir.groups[0].sequencedIntents[0].endTime).toBe("00:45");
    expect(ir.groups[0].sequencedIntents[0].assumptions).toContain(
      "rolled over to next day after cross-midnight previous event"
    );
  });

  it("date 明示なしの cross-midnight sequence は referenceDate を起点に rollover できる", () => {
    const clauses = parseClauses(
      "23時から1時間情報のレポートを書いて、そのあと0時15分から30分だけ英単語をやる"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-12");
    expect(ir.groups[0].sequencedIntents).toHaveLength(1);
    expect(ir.groups[0].sequencedIntents[0].date).toBe("2026-04-13");
    expect(ir.groups[0].sequencedIntents[0].startTime).toBe("00:15");
    expect(ir.groups[0].sequencedIntents[0].endTime).toBe("00:45");
  });

  it("mixed connective sentence の shared date head を後続 block まで concrete 化できる", () => {
    const clauses = parseClauses(
      "明日の7時から30分システム英単語、そのあと8時から9時半まで青チャート、夜は20時から1時間、現代文"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(2);
    expect([
      ir.groups[0].base.date,
      ir.groups[0].sequencedIntents[0]?.date,
      ir.groups[1].base.date,
    ]).toEqual([
      "2026-04-13",
      "2026-04-13",
      "2026-04-13",
    ]);
  });

  it("文をまたいだ時間帯 block でも前の scoped date を継承できる", () => {
    const clauses = parseClauses(
      "明日の7時から30分システム英単語、そのあと8時から9時半まで青チャート。夜は20時から1時間、現代文。"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-12" });

    expect(ir.groups).toHaveLength(2);
    expect([
      ir.groups[0].base.date,
      ir.groups[0].sequencedIntents[0]?.date,
      ir.groups[1].base.date,
    ]).toEqual([
      "2026-04-13",
      "2026-04-13",
      "2026-04-13",
    ]);
  });

  it("weekday をまたぐ overnight range を単発 event として concrete date にできる", () => {
    const clauses = parseClauses("土曜の夜22時から日曜の0時まで過去問演習");
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-16" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.date).toBe("2026-04-18");
    expect(ir.groups[0].base.weekdays).toBeUndefined();
    expect(ir.groups[0].base.startTime).toBe("22:00");
    expect(ir.groups[0].base.endTime).toBe("00:00");
    expect(ir.groups[0].base.assumptions).toContain(
      "overnight weekday range treated as single event"
    );
  });

  it("reverse-order override を daily_except_wed + weekly_wed として正規化できる", () => {
    const clauses = parseClauses(
      "水曜だけ22時、他の日は毎日20時から21時で勉強予定を入れて"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-18" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.startTime).toBe("20:00");
    expect(ir.groups[0].base.endTime).toBe("21:00");
    expect(ir.groups[0].base.excludedWeekdays).toEqual(["wed"]);
    expect(ir.groups[0].overrideIntents).toHaveLength(1);
    expect(ir.groups[0].overrideIntents[0].weekdays).toEqual(["wed"]);
    expect(ir.groups[0].overrideIntents[0].startTime).toBe("22:00");
    expect(ir.groups[0].overrideIntents[0].endTime).toBe("23:00");
  });

  it("複数の reverse-order override を base exclusion と共存させられる", () => {
    const ast: ScheduleAST = {
      groups: [
        {
          base: {
            rawText: "他の日は毎日7時から30分",
            contentText: "勉強予定",
            timeSpec: {
              raw: "07:00",
              hour: 7,
              minute: 0,
              hm: "07:00",
            },
            durationSpec: {
              raw: "30分",
              minutes: 30,
            },
            repeatSpec: {
              raw: "毎日",
              kind: "daily",
            },
          },
          sequences: [],
          overrides: [
            {
              rawText: "火曜だけ6時半から30分",
              weekdaySpecs: [{ raw: "火曜", weekday: "tue" }],
              replaceTimeSpec: {
                raw: "06:30",
                hour: 6,
                minute: 30,
                hm: "06:30",
              },
              replaceDurationSpec: {
                raw: "30分",
                minutes: 30,
              },
            },
            {
              rawText: "金曜だけ6時半から30分",
              weekdaySpecs: [{ raw: "金曜", weekday: "fri" }],
              replaceTimeSpec: {
                raw: "06:30",
                hour: 6,
                minute: 30,
                hm: "06:30",
              },
              replaceDurationSpec: {
                raw: "30分",
                minutes: 30,
              },
            },
          ],
          attachments: [],
          enumerations: [],
        },
      ],
      diagnostics: [],
    };
    const ir = lowerToIR(ast, { referenceDate: "2026-04-18" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.dayType).toBeUndefined();
    expect(ir.groups[0].base.repeatSpec?.kind).toBe("daily");
    expect(ir.groups[0].base.excludedWeekdays?.slice().sort()).toEqual([
      "fri",
      "tue",
    ]);
    expect(ir.groups[0].overrideIntents).toHaveLength(2);
    expect(
      ir.groups[0].overrideIntents.map((override) => override.weekdays?.[0]).sort()
    ).toEqual(["fri", "tue"]);
    expect(ir.groups[0].overrideIntents.every((override) => override.endTime === "07:00")).toBe(
      true,
    );
  });

  it("set-count attachment を base の loop metadata と content override に反映できる", () => {
    const clauses = parseClauses(
      "14時から50分勉強して10分休憩、これを3セットで数学にして"
    );
    const ast = buildAST(clauses);
    const ir = lowerToIR(ast, { referenceDate: "2026-04-18" });

    expect(ir.groups).toHaveLength(1);
    expect(ir.groups[0].base.contentText).toBe("数学");
    expect(ir.groups[0].base.setCount).toBe(3);
    expect(ir.groups[0].base.durationMinutes).toBe(50);
    expect(ir.groups[0].base.restDurationMinutes).toBe(10);
    expect(ir.groups[0].base.assumptions).toContain("set-count attached");
    expect(ir.groups[0].base.assumptions).toContain("content override attached");
  });
});
