import { describe, expect, test } from "bun:test";
import { createObsCaptionSender } from "./obs-caption-transport.ts";

const state = (japanese) => ({
  entries: [],
  targets: ["en"],
  japaneseFontSize: 24,
  japaneseColor: "#ffffff",
  translationStyles: { en: { fontSize: 20, color: "#8ee8c5" } },
  alignment: "center",
  verticalAlignment: "bottom",
  captionStyle: "labeled",
  captionHoldMs: 10_000,
  marker: japanese,
});

describe("OBS caption sender", () => {
  test("送信中のdeltaは最新スナップショットへまとめる", async () => {
    const sent = [];
    let releaseFirst;
    const firstRequest = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const sender = createObsCaptionSender(async (snapshot) => {
      sent.push(snapshot.marker);
      if (sent.length === 1) await firstRequest;
    });

    const first = sender.publish(state("仮"));
    sender.publish(state("仮字幕"));
    sender.publish(state("完成字幕"));
    releaseFirst();
    await first;

    expect(sent).toEqual(["仮", "完成字幕"]);
  });

  test("close後は新しい字幕を送らない", async () => {
    const sent = [];
    const sender = createObsCaptionSender(async (snapshot) => {
      sent.push(snapshot.marker);
    });
    sender.close();
    await sender.publish(state("送られない"));
    expect(sent).toEqual([]);
  });
});
