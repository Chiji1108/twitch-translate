import { describe, expect, test } from "bun:test";
import {
  getNextCaptionDeadline,
  getVisibleCaptionEntries,
} from "./caption-lifetime.ts";

const completedEntry = {
  id: 1,
  japanese: "字幕",
  furigana: [],
  translations: { en: "Caption" },
  provisional: false,
  completed: true,
  completedAt: 1_000,
};

describe("caption lifetime", () => {
  test("表示時間後にフェードし、フェード完了後に非表示になる", () => {
    expect(
      getVisibleCaptionEntries([completedEntry], 10_000, 10_999)[0],
    ).toMatchObject({ fading: false });
    expect(
      getVisibleCaptionEntries([completedEntry], 10_000, 11_000)[0],
    ).toMatchObject({ fading: true });
    expect(getVisibleCaptionEntries([completedEntry], 10_000, 11_500)).toEqual(
      [],
    );
  });

  test("次のフェードまたは削除時刻を返す", () => {
    expect(getNextCaptionDeadline([completedEntry], 10_000, 5_000)).toBe(
      11_000,
    );
    expect(getNextCaptionDeadline([completedEntry], 10_000, 11_200)).toBe(
      11_500,
    );
  });

  test("デモ字幕は時間で消えない", () => {
    expect(
      getVisibleCaptionEntries(
        [{ ...completedEntry, demo: true }],
        10_000,
        99_999,
      ),
    ).toHaveLength(1);
  });
});
