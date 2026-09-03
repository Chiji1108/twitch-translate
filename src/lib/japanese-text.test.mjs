import { describe, expect, test } from "bun:test";
import { normalizeJapanesePunctuation } from "./japanese-text.ts";

describe("normalizeJapanesePunctuation", () => {
  test("半角の感嘆符と疑問符だけを全角にする", () => {
    expect(normalizeJapanesePunctuation("本当に!? 大丈夫? Yes!")).toBe(
      "本当に！？ 大丈夫？ Yes！",
    );
  });

  test("全角記号とそれ以外の文字は変更しない", () => {
    expect(normalizeJapanesePunctuation("今日は晴れ！ そうだね？。")).toBe(
      "今日は晴れ！ そうだね？。",
    );
  });
});
