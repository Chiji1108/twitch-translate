import { beforeEach, describe, expect, test } from "bun:test";
import {
  defaultSettings,
  emptySubtitleState,
  parseStoredSettings,
  useCaptionStore,
} from "./caption-store.ts";

beforeEach(() => {
  useCaptionStore.setState({
    ...defaultSettings(),
    status: "idle",
    entries: [],
    captionError: null,
    showingDemo: false,
    isSpeaking: false,
    pendingTurns: 0,
    processingStage: "idle",
  });
});

describe("caption store", () => {
  test("仮字幕を同じIDの完成字幕へ段階的に更新できる", () => {
    const { setEntries } = useCaptionStore.getState();
    setEntries([
      {
        id: 1,
        japanese: "仮字幕",
        furigana: [],
        translations: {},
        provisional: true,
        completed: false,
      },
    ]);
    setEntries((entries) =>
      entries.map((entry) =>
        entry.id === 1
          ? {
              ...entry,
              japanese: "日本語字幕",
              translations: { en: "Japanese subtitles" },
              provisional: false,
              completed: true,
            }
          : entry,
      ),
    );

    expect(useCaptionStore.getState().entries).toEqual([
      expect.objectContaining({
        id: 1,
        japanese: "日本語字幕",
        translations: { en: "Japanese subtitles" },
        provisional: false,
        completed: true,
      }),
    ]);
  });

  test("字幕出力だけを差し替えても録音設定は維持する", () => {
    useCaptionStore.getState().setSentencePauseMs(1500);
    const subtitle = {
      ...emptySubtitleState(),
      alignment: "right",
      entries: [
        {
          id: 2,
          japanese: "テスト",
          furigana: [],
          translations: { en: "Test" },
          provisional: false,
          completed: true,
        },
      ],
    };
    useCaptionStore.getState().replaceSubtitleState(subtitle);

    const state = useCaptionStore.getState();
    expect(state.alignment).toBe("right");
    expect(state.entries[0]?.japanese).toBe("テスト");
    expect(state.sentencePauseMs).toBe(1500);
  });

  test("保存設定を対応言語と許容範囲に正規化する", () => {
    const settings = parseStoredSettings(
      JSON.stringify({
        targets: ["en", "ru", "unknown", "en"],
        sentencePauseMs: 99999,
        japaneseFontSize: 20,
        translationStyles: {
          en: { fontSize: 10, color: "#8ee8c5" },
        },
        japaneseColor: "invalid",
        alignment: "right",
      }),
    );

    expect(settings?.targets).toEqual(["en", "ru"]);
    expect(settings?.sentencePauseMs).toBe(1000);
    expect(settings?.japaneseFontSize).toBe(20);
    expect(settings?.translationStyles.en?.fontSize).toBe(10);
    expect(settings?.japaneseColor).toBe("#ffffff");
    expect(settings?.alignment).toBe("right");
  });
});
