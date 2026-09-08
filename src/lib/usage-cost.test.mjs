import { describe, expect, test } from "bun:test";
import {
  addCaptionUsage,
  addLiveTranscriptionUsage,
  emptySessionUsage,
  estimateSessionCost,
  formatEstimatedUsd,
} from "./usage-cost.ts";

describe("usage cost", () => {
  test("音声時間とTerraのトークンをモデル別に集計する", () => {
    let usage = addLiveTranscriptionUsage(emptySessionUsage(), {
      type: "duration",
      seconds: 60,
    });
    usage = addCaptionUsage(usage, {
      transcription: { type: "duration", seconds: 30 },
      furigana: {
        prompt_tokens: 1_000,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 200 },
      },
      translations: {
        en: { prompt_tokens: 500, completion_tokens: 50 },
      },
    });

    expect(usage).toEqual({
      liveAudioSeconds: 60,
      transcriptionAudioSeconds: 30,
      terraInputTokens: 1_500,
      terraCachedInputTokens: 200,
      terraOutputTokens: 150,
    });
    const costs = estimateSessionCost(usage);
    expect(costs.liveTranscription).toBeCloseTo(0.017);
    expect(costs.transcription).toBeCloseTo(0.00225);
    expect(costs.terra).toBeCloseTo(0.00444);
    expect(costs.total).toBeCloseTo(0.02369);
  });

  test("Liveのusageが未確定の間は接続時間を推定値に使う", () => {
    const costs = estimateSessionCost(emptySessionUsage(), 30);
    expect(costs.liveTranscription).toBeCloseTo(0.0085);
    expect(formatEstimatedUsd(costs.total)).toBe("$0.00850");
  });
});
