import { describe, expect, it } from "vitest";
import {
  parseNaturalLanguageSchedule,
  runNaturalLanguagePipeline,
} from "../index";
import type { Suggestion } from "../shared/types";

describe("natural-language integration", () => {
  it("全文を最後まで流して nightly review を1件にまとめられる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.title).toBe("英単語の復習");
    expect(suggestions[0].parsedPlan.subject).toBe("英語");
    expect(suggestions[0].parsedPlan.startTime).toBe("23:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("23:15");
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "daily",
      startTime: "23:00",
      endTime: "23:15",
    });
  });

  it("base と override を最後まで流して3件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "平日は毎朝7時から30分。ただし火曜と金曜は6時半から。"
    );

    expect(suggestions).toHaveLength(3);

    const base = suggestions[0];
    expect(base.parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "day-type",
      dayType: "weekday",
      startTime: "07:00",
      endTime: "07:30",
    });
    expect(
      base.parsedPlan.recurrenceRules?.[0].excludedWeekdays?.slice().sort()
    ).toEqual(["fri", "tue"]);

    const overrideWeekdays = suggestions
      .slice(1)
      .map(
        (suggestion: Suggestion) =>
          suggestion.parsedPlan.recurrenceRules?.[0].weekdays?.[0]
      )
      .sort();

    expect(overrideWeekdays).toEqual(["fri", "tue"]);
  });

  it("relative ordering を日付つきで最後まで流して2件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日19時から数学を1時間。そのあと英単語を30分",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(2);

    expect(suggestions[0].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[0].parsedPlan.startTime).toBe("19:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("20:00");
    expect(suggestions[0].parsedPlan.subject).toBe("数学");

    expect(suggestions[1].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[1].parsedPlan.startTime).toBe("20:00");
    expect(suggestions[1].parsedPlan.endTime).toBe("20:30");
    expect(suggestions[1].parsedPlan.subject).toBe("英語");
    expect(suggestions[1].assumptions).toContain(
      "date inherited from previous event"
    );
    expect(suggestions[1].assumptions).toContain(
      "anchored to previous event endTime"
    );
  });

  it("enumeration を最後まで流して3件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.title)
    ).toEqual(["英語長文", "単語", "英文法"]);
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.subject)
    ).toEqual(["英語", "英語", "英語"]);
    expect(suggestions[0].parsedPlan.dateSpec?.kind).toBe("week-scope");
    expect(
      suggestions.map((suggestion: Suggestion) => suggestion.parsedPlan.date)
    ).toEqual(["2026-04-20", "2026-04-21", "2026-04-22"]);
    expect(suggestions[0].unresolvedFields).not.toContain("date");
  });

  it("独立したイベントを最後まで流して2件にできる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日19時から数学を1時間。明後日20時から英語を30分",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[0].parsedPlan.subject).toBe("数学");
    expect(suggestions[1].parsedPlan.date).toBe("2026-04-18");
    expect(suggestions[1].parsedPlan.subject).toBe("英語");
  });

  it("1文内の複数明示時間ブロックを複数 suggestion として抽出できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "今日の9時から11時まで情報の課題、13時から14時まで英語長文、15時から16時半まで物理をやる。",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-16");
    expect(suggestions[0].parsedPlan.startTime).toBe("09:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("11:00");
    expect(suggestions[1].parsedPlan.date).toBe("2026-04-16");
    expect(suggestions[1].parsedPlan.startTime).toBe("13:00");
    expect(suggestions[1].parsedPlan.endTime).toBe("14:00");
    expect(suggestions[2].parsedPlan.date).toBe("2026-04-16");
    expect(suggestions[2].parsedPlan.startTime).toBe("15:00");
    expect(suggestions[2].parsedPlan.endTime).toBe("16:30");
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "情報の課題",
      "英語長文",
      "物理",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "情報",
      "英語",
      "物理",
    ]);
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "のまで情報の課題")).toBe(
      false
    );
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "まで物理をやる")).toBe(
      false
    );
  });

  it("shared week scope head を後続 explicit time block に継承できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "今週の土曜日、9時から11時まで数学、13時から16時まで英語、20時から21時まで復習",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.date)).toEqual([
      "2026-04-18",
      "2026-04-18",
      "2026-04-18",
    ]);
    expect(
      suggestions.every((suggestion) => !suggestion.parsedPlan.recurrenceRules)
    ).toBe(true);
  });

  it("mixed connective sentence でも shared date head を後続 block に継承できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日の7時から30分システム英単語、そのあと8時から9時半まで青チャート、夜は20時から1時間、現代文",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.date)).toEqual([
      "2026-04-13",
      "2026-04-13",
      "2026-04-13",
    ]);
  });

  it("1文内の複数明示時間ブロックでも相対順序テストを壊さない", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "9時から10時まで英語、10分休憩して、10時10分から11時40分まで数学、13時から14時まで物理",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].parsedPlan.startTime).toBe("09:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("10:00");
    expect(suggestions[1].parsedPlan.startTime).toBe("10:10");
    expect(suggestions[1].parsedPlan.endTime).toBe("11:40");
    expect(suggestions[2].parsedPlan.startTime).toBe("13:00");
    expect(suggestions[2].parsedPlan.endTime).toBe("14:00");
  });

  it("補足句は standalone な suggestion にせず、主イベントだけ残せる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "4月15日の19時から21時までTOEICの勉強を入れて。内容は単語とリスニング。"
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.startTime).toBe("19:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("21:00");
  });

  it("複数明示時間ブロックでも title が青チャート / 現代文に汚れず残る", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "明日の7時から30分システム英単語、そのあと8時から9時半まで青チャート。夜は20時から1時間、現代文。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "システム英単語",
      "青チャート",
      "現代文",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "英語",
      "数学",
      "国語",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.date)).toEqual([
      "2026-04-13",
      "2026-04-13",
      "2026-04-13",
    ]);
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "まで青チャート")).toBe(
      false
    );
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "夜はから現代文")).toBe(
      false
    );
  });

  it("relative ordering を壊さず title の前後ノイズを落とせる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "10時から化学を90分、そのあと30分休んで、12時から1時間英語をやる。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "化学",
      "英語",
    ]);
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "から化学を")).toBe(
      false
    );
    expect(suggestions.some((suggestion) => suggestion.parsedPlan.title === "から英語をやる")).toBe(
      false
    );
    expect(suggestions[0].parsedPlan.startTime).toBe("10:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("11:30");
    expect(suggestions[1].parsedPlan.startTime).toBe("12:00");
    expect(suggestions[1].parsedPlan.endTime).toBe("13:00");
  });

  it("良問の風 と 古文単語315 の subject を局所ルールで自然に推定できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "朝8時から30分システム英単語、9時から11時まで良問の風、夜は22時から20分古文単語315をやる。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "英語",
      "物理",
      "国語",
    ]);
  });

  it("generic subject prefix は落とし、task noun phrase は全体保持した title を end-to-end で作れる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "19時から数学の黄色チャートを進める。20時から物理の良問の風を進める。21時から情報のレポートを書いて。22時からTOEICの勉強。23時から英単語の復習。0時から週の振り返り。1時から自習の勉強。",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "黄色チャート",
      "良問の風",
      "情報のレポート",
      "TOEICの勉強",
      "英単語の復習",
      "週の振り返り",
      "自習時間",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "数学",
      "物理",
      "情報",
      "英語",
      "英語",
      "振り返り",
      "自習",
    ]);
  });

  it("title は specific を保ち、subject は broad なまま end-to-end で分離できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "19時から数学をやるようにしたい。20時から数学の黄色チャートをやる。21時から物理の良問の風をやる。",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "数学",
      "黄色チャート",
      "良問の風",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "数学",
      "数学",
      "物理",
    ]);
  });

  it("共通テストの過去問演習を 演習 subject として推定できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "土日は朝9時から2時間、共通テストの過去問演習を入れて。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.subject).toBe("演習");
  });

  it("specific title を保ったまま broad subject family へ end-to-end 補正できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "19時から黄色チャート。20時から良問の風。21時から共通テスト過去問演習。22時からTOEICの勉強。23時から週の振り返り。0時から自習時間。1時から情報のレポート。",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "黄色チャート",
      "良問の風",
      "共通テスト過去問演習",
      "TOEICの勉強",
      "週の振り返り",
      "自習時間",
      "情報のレポート",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "数学",
      "物理",
      "演習",
      "英語",
      "振り返り",
      "自習",
      "情報",
    ]);
  });

  it("referenceDate normalization と explicit / scoped date resolution を end-to-end で扱える", () => {
    const relativeSuggestions = parseNaturalLanguageSchedule(
      "明日19時から数学を1時間",
      { referenceDate: "2026/4/16" }
    );
    expect(relativeSuggestions).toHaveLength(1);
    expect(relativeSuggestions[0].parsedPlan.date).toBe("2026-04-17");

    const explicitSuggestions = parseNaturalLanguageSchedule(
      "4月15日19時から21時まで自習する",
      { referenceDate: "2026-04-12" }
    );
    expect(explicitSuggestions).toHaveLength(1);
    expect(explicitSuggestions[0].parsedPlan.date).toBe("2026-04-15");

    const scopedSuggestions = parseNaturalLanguageSchedule(
      "今週の土曜日、9時から11時まで数学",
      { referenceDate: "2026-04-16" }
    );
    expect(scopedSuggestions).toHaveLength(1);
    expect(scopedSuggestions[0].parsedPlan.date).toBe("2026-04-18");
  });

  it("month-scope recurrence を representative date と until の整合つきで end-to-end で扱える", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "4月中の平日7時から30分英語",
      { referenceDate: "2026-04-18" }
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-20");
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "day-type",
      dayType: "weekday",
      startDate: "2026-04-20",
      until: "2026-04-30",
      startTime: "07:00",
      endTime: "07:30",
    });
  });

  it("daily + saturday override を month-scope date window つきで end-to-end で扱える", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "4月中は毎朝6時半から30分英語、その代わり土曜だけ8時から30分",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.title).toBe("英語");
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "daily",
      startDate: "2026-04-17",
      until: "2026-04-30",
      excludedWeekdays: ["sat"],
      startTime: "06:30",
      endTime: "07:00",
    });
    expect(suggestions[1].parsedPlan.title).toBe("英語");
    expect(suggestions[1].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["sat"],
      startDate: "2026-04-18",
      until: "2026-04-30",
      startTime: "08:00",
      endTime: "08:30",
      isOverride: true,
    });
  });

  it("explicit until recurring を representative date / startDate / until 整合つきで end-to-end で扱える", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "4月19日まで毎日18時から20時英語",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-17");
    expect(suggestions[0].parsedPlan.startTime).toBe("18:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("20:00");
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "daily",
      startDate: "2026-04-17",
      until: "2026-04-19",
      startTime: "18:00",
      endTime: "20:00",
    });
  });

  it("曜日 family を分離しつつ sunday rest directive を event として出さない", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "月水金は数学、火木土は英語、日曜は休み",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "数学",
      "英語",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "数学",
      "英語",
    ]);
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["mon", "wed", "fri"],
    });
    expect(suggestions[1].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["tue", "thu", "sat"],
    });
  });

  it("weekday overnight range を単発 event として扱い weekly_sat_sun にしない", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "土曜の夜22時から日曜の0時まで過去問演習",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.title).toBe("過去問演習");
    expect(suggestions[0].parsedPlan.subject).toBe("演習");
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-18");
    expect(suggestions[0].parsedPlan.startTime).toBe("22:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("00:00");
    expect(suggestions[0].parsedPlan.recurrenceRules).toBeUndefined();
  });

  it("英語 enumeration の短い variant title を base context で補正できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "英語長文",
      "単語",
      "英文法",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "英語",
      "英語",
      "英語",
    ]);
  });

  it("複合 recurring family を混ぜずに分離できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "平日は毎朝6時半から30分英語、月水金の夜は数学、火木の夜は物理、土曜は過去問、日曜は振り返り",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(5);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "英語",
      "数学",
      "物理",
      "過去問",
      "振り返り",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.subject)).toEqual([
      "英語",
      "数学",
      "物理",
      "演習",
      "振り返り",
    ]);
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "day-type",
      dayType: "weekday",
      startTime: "06:30",
      endTime: "07:00",
    });
    expect(suggestions[1].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["mon", "wed", "fri"],
    });
    expect(suggestions[2].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["tue", "thu"],
    });
    expect(suggestions[3].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["sat"],
    });
    expect(suggestions[4].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["sun"],
    });
  });

  it("cross-midnight sequence を開始日基準のまま翌日に rollover できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "今日23時から1時間情報のレポート。そのあと0時15分から30分英単語",
      { referenceDate: "2026-04-12" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.date).toBe("2026-04-12");
    expect(suggestions[0].parsedPlan.startTime).toBe("23:00");
    expect(suggestions[0].parsedPlan.endTime).toBe("00:00");
    expect(suggestions[1].parsedPlan.date).toBe("2026-04-13");
    expect(suggestions[1].parsedPlan.startTime).toBe("00:15");
    expect(suggestions[1].parsedPlan.endTime).toBe("00:45");
  });

  it("scope-only control clause を standalone event として emit しない", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法で、全部20時から1時間。",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "英語長文",
      "単語",
      "英文法",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.startTime)).toEqual([
      "20:00",
      "20:00",
      "20:00",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.endTime)).toEqual([
      "21:00",
      "21:00",
      "21:00",
    ]);
  });

  it("set-count を generic loop expansion として end-to-end で展開できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "14時から50分勉強して10分休憩、これを3セットで数学にして",
      { referenceDate: "2026-04-18" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "数学",
      "数学",
      "数学",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.startTime)).toEqual([
      "14:00",
      "15:00",
      "16:00",
    ]);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.endTime)).toEqual([
      "14:50",
      "15:50",
      "16:50",
    ]);
  });

  it("set-count と enumeration が共存する場合は壊れた loop 展開をせず assumptions に残せる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法で、これを2セット",
      { referenceDate: "2026-04-18" }
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "英語長文",
      "単語",
      "英文法",
    ]);
    expect(
      suggestions.every((suggestion) =>
        suggestion.assumptions.includes(
          "set-count は recurrence / override / enumeration と競合するため未展開のまま保持しました",
        ),
      ),
    ).toBe(true);
  });

  it("reverse-order override を end-to-end で base recurrence + override recurrence に分離できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "水曜だけ22時、他の日は毎日20時から21時で勉強予定を入れて",
      { referenceDate: "2026-04-18" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "daily",
      excludedWeekdays: ["wed"],
      startTime: "20:00",
      endTime: "21:00",
    });
    expect(suggestions[1].parsedPlan.recurrenceRules?.[0]).toMatchObject({
      kind: "weekday",
      weekdays: ["wed"],
      startTime: "22:00",
      endTime: "23:00",
    });
  });

  it("複数イベント文でも adapter 用の local subject/type 推定が他イベントへ汚染されない", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "土日は朝9時から2時間、共通テストの過去問演習。15時から16時まで情報の課題。",
      { referenceDate: "2026-04-18" }
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.subject).toBe("演習");
    expect(suggestions[1].parsedPlan.subject).toBe("情報");
  });

  it("catalog 未登録でも教材名・課題名・作業名を自然な title として抽出できる", () => {
    const suggestions = parseNaturalLanguageSchedule(
      "寝る前にDUO3.0を30分。19時から学校ワークAを進める。20時から期末レポートの考察を書く。21時からWeb開発課題の修正。22時から統計学小テストの見直し。",
      { referenceDate: "2026-04-16" }
    );

    expect(suggestions).toHaveLength(5);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      "DUO3.0",
      "学校ワークA",
      "期末レポートの考察",
      "Web開発課題の修正",
      "統計学小テストの見直し",
    ]);
  });

  it("デバッグ用に中間結果もまとめて取れる", () => {
    const result = runNaturalLanguagePipeline("毎晩英単語を復習");

    expect(result.normalizedText).toBe("毎晩英単語を復習");
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.clauses).toHaveLength(1);
    expect(result.ast.groups).toHaveLength(1);
    expect(result.ir.groups[0].base.unresolvedFields).toContain("startTime");
    expect(result.ir.groups[0].base.unresolvedFields).toContain("endTime");
    expect(result.suggestions).toHaveLength(1);
  });

  it("空文字は空配列で返せる", () => {
    const suggestions = parseNaturalLanguageSchedule("   ");
    expect(suggestions).toEqual([]);
  });
});
