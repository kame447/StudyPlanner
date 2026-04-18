import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenizer";

describe("tokenize", () => {
  it("毎晩の復習文を主要トークンへ分解できる", () => {
    const tokens = tokenize(
      "毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。"
    );

    expect(tokens).toEqual([
      {
        kind: "REPEAT",
        raw: "毎晩",
        value: { raw: "毎晩", kind: "daily", anchor: "night" },
      },
      {
        kind: "CONTENT",
        raw: "寝る前に",
      },
      {
        kind: "DURATION",
        raw: "15分",
        value: { raw: "15分", minutes: 15 },
      },
      {
        kind: "CONTENT",
        raw: "だけ英単語の復習を入れて時間は",
      },
      {
        kind: "TIME",
        raw: "23:00",
        value: { raw: "23:00", hour: 23, minute: 0, hm: "23:00" },
      },
      {
        kind: "CONTENT",
        raw: "で",
      },
    ]);
  });

  it("平日ベースと曜日指定を抽出できる", () => {
    const tokens = tokenize("平日は毎朝7時から30分。火曜と金曜は6時半から。");

    expect(tokens).toEqual([
      {
        kind: "DAYTYPE",
        raw: "平日",
        value: { raw: "平日", dayType: "weekday" },
      },
      {
        kind: "CONTENT",
        raw: "は",
      },
      {
        kind: "REPEAT",
        raw: "毎朝",
        value: { raw: "毎朝", kind: "daily", anchor: "morning" },
      },
      {
        kind: "TIME",
        raw: "07:00",
        value: { raw: "07:00", hour: 7, minute: 0, hm: "07:00" },
      },
      {
        kind: "CONTENT",
        raw: "から",
      },
      {
        kind: "DURATION",
        raw: "30分",
        value: { raw: "30分", minutes: 30 },
      },
      {
        kind: "WEEKDAY",
        raw: "火曜",
        value: { raw: "火曜", weekday: "tue" },
      },
      {
        kind: "CONTENT",
        raw: "と",
      },
      {
        kind: "WEEKDAY",
        raw: "金曜",
        value: { raw: "金曜", weekday: "fri" },
      },
      {
        kind: "CONTENT",
        raw: "は",
      },
      {
        kind: "TIME",
        raw: "06:30",
        value: { raw: "06:30", hour: 6, minute: 30, hm: "06:30" },
      },
      {
        kind: "CONTENT",
        raw: "から",
      },
    ]);
  });

  it("そのあと を CONNECTIVE として取れる", () => {
    const tokens = tokenize("明日19時から数学を1時間。そのあと英単語を30分");

    const kinds = tokens.map((token) => token.kind);
    expect(kinds).toContain("CONNECTIVE");
  });

  it("明日を DATE token として取れる", () => {
    const tokens = tokenize("明日19時から数学を1時間");
    expect(tokens[0]).toEqual({
      kind: "DATE",
      raw: "明日",
      value: {
        raw: "明日",
        kind: "relative-day",
        offsetDays: 1,
      },
    });
  });

  it("来週のどこかを DATE token として取れる", () => {
    const tokens = tokenize("来週のどこかで英語を3回");
    expect(tokens[0]).toEqual({
      kind: "DATE",
      raw: "来週のどこか",
      value: {
        raw: "来週のどこか",
        kind: "week-scope",
        scope: "sometime-next-week",
      },
    });
  });

  it("休憩トークンは DURATION より先に REST として取れる", () => {
    const tokens = tokenize("14時から50分勉強して10分休憩");

    expect(tokens.some((token) => token.kind === "REST")).toBe(true);
    expect(tokens.find((token) => token.kind === "REST")).toMatchObject({
      kind: "REST",
      raw: "10分休憩",
      value: { raw: "10分休憩", minutes: 10 },
    });
  });
});
