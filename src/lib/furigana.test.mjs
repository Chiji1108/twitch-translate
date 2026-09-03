import { describe, expect, test } from "bun:test";
import {
  buildFuriganaSegments,
  extractKanjiRuns,
  validateFuriganaSegments,
} from "./furigana.ts";

describe("extractKanjiRuns", () => {
  test("すべての連続漢字へ一意なキーと位置を付ける", () => {
    expect(extractKanjiRuns("今日も今日、新しいと思う")).toEqual([
      { key: "r0", text: "今日", start: 0, end: 2 },
      { key: "r1", text: "今日", start: 3, end: 5 },
      { key: "r2", text: "新", start: 6, end: 7 },
      { key: "r3", text: "思", start: 10, end: 11 },
    ]);
  });
});

describe("buildFuriganaSegments", () => {
  test("原文を再生成せず読みだけを差し込む", () => {
    expect(
      buildFuriganaSegments("今日はいい天気だね。", {
        r0: [{ text: "今日", reading: "きょう" }],
        r1: [{ text: "天気", reading: "てんき" }],
      }),
    ).toEqual({
      segments: [
        { text: "今日", reading: "きょう" },
        { text: "はいい", reading: null },
        { text: "天気", reading: "てんき" },
        { text: "だね。", reading: null },
      ],
      error: null,
    });
  });

  test("必須の読みが欠けている場合は拒否する", () => {
    expect(buildFuriganaSegments("今日", {}).error?.code).toBe(
      "reading_groups_not_array",
    );
  });

  test("連続漢字を自然な語単位に分けてルビを付ける", () => {
    expect(
      buildFuriganaSegments("確定文字起こし", {
        r0: [
          { text: "確定", reading: "かくてい" },
          { text: "文字", reading: "もじ" },
          { text: "起", reading: "お" },
        ],
      }),
    ).toEqual({
      segments: [
        { text: "確定", reading: "かくてい" },
        { text: "文字", reading: "もじ" },
        { text: "起", reading: "お" },
        { text: "こし", reading: null },
      ],
      error: null,
    });
  });

  test("漢字列を変更した読み分けを拒否する", () => {
    expect(
      buildFuriganaSegments("確定文字", {
        r0: [{ text: "確定文書", reading: "かくていぶんしょ" }],
      }).error?.code,
    ).toBe("kanji_run_mismatch");
  });
});

describe("validateFuriganaSegments", () => {
  test("文脈に沿った読みと原文一致を検証する", () => {
    const segments = [
      { text: "そこら", reading: null },
      { text: "辺", reading: "へん" },
    ];
    expect(validateFuriganaSegments("そこら辺", segments)).toEqual({
      segments,
      error: null,
    });
  });

  test("原文を変更した応答を拒否する", () => {
    const result = validateFuriganaSegments("もう一回", [
      { text: "もう", reading: null },
      { text: "一度", reading: "いちど" },
    ]);
    expect(result.error?.code).toBe("source_mismatch");
  });

  test("漢字の読みが欠けた応答を拒否する", () => {
    const result = validateFuriganaSegments("今日", [
      { text: "今日", reading: null },
    ]);
    expect(result.error?.code).toBe("kanji_reading_missing");
  });
});
