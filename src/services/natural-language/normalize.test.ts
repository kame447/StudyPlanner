import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("全角数字と全角記号を正規化できる", () => {
    expect(normalizeText("　２３時半　")).toBe("23:30");
  });

  it("12時34分をHH:MMへ変換できる", () => {
    expect(normalizeText("１２時３４分")).toBe("12:34");
  });

  it("7時をHH:MMへ変換できる", () => {
    expect(normalizeText("７時")).toBe("07:00");
  });

  it("波ダッシュをハイフンへ正規化できる", () => {
    expect(normalizeText("７時〜８時")).toBe("07:00-08:00");
  });

  it("空白を整理できる", () => {
    expect(normalizeText("  毎晩   23時  ")).toBe("毎晩 23:00");
  });
});
