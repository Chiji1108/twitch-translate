export type OpenAIUsage = {
  type?: "duration" | "tokens";
  seconds?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
};

export type CaptionUsagePayload = {
  transcription?: OpenAIUsage;
  translations?: Record<string, OpenAIUsage | undefined>;
  furigana?: OpenAIUsage;
};

export type SessionUsage = {
  liveAudioSeconds: number;
  transcriptionAudioSeconds: number;
  captionInputTokens: number;
  captionCachedInputTokens: number;
  captionOutputTokens: number;
};

const GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE = 0.017;
const GPT_TRANSCRIBE_USD_PER_MINUTE = 0.0045;
const CAPTION_INPUT_USD_PER_MILLION_TOKENS = 0.2;
const CAPTION_CACHED_INPUT_USD_PER_MILLION_TOKENS = 0.02;
const CAPTION_OUTPUT_USD_PER_MILLION_TOKENS = 1.2;

function nonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function emptySessionUsage(): SessionUsage {
  return {
    liveAudioSeconds: 0,
    transcriptionAudioSeconds: 0,
    captionInputTokens: 0,
    captionCachedInputTokens: 0,
    captionOutputTokens: 0,
  };
}

export function addLiveTranscriptionUsage(
  current: SessionUsage,
  usage: OpenAIUsage | undefined,
): SessionUsage {
  return {
    ...current,
    liveAudioSeconds: current.liveAudioSeconds + nonNegative(usage?.seconds),
  };
}

function addCaptionModelUsage(current: SessionUsage, usage?: OpenAIUsage) {
  if (!usage) return current;
  const inputTokens = nonNegative(usage.prompt_tokens ?? usage.input_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    nonNegative(
      usage.prompt_tokens_details?.cached_tokens ??
        usage.input_tokens_details?.cached_tokens,
    ),
  );
  return {
    ...current,
    captionInputTokens: current.captionInputTokens + inputTokens,
    captionCachedInputTokens:
      current.captionCachedInputTokens + cachedInputTokens,
    captionOutputTokens:
      current.captionOutputTokens +
      nonNegative(usage.completion_tokens ?? usage.output_tokens),
  };
}

export function addCaptionUsage(
  current: SessionUsage,
  usage: CaptionUsagePayload | undefined,
): SessionUsage {
  if (!usage) return current;
  let next = {
    ...current,
    transcriptionAudioSeconds:
      current.transcriptionAudioSeconds +
      nonNegative(usage.transcription?.seconds),
  };
  next = addCaptionModelUsage(next, usage.furigana);
  for (const translationUsage of Object.values(usage.translations ?? {})) {
    next = addCaptionModelUsage(next, translationUsage);
  }
  return next;
}

export function estimateSessionCost(
  usage: SessionUsage,
  connectedLiveAudioSeconds = 0,
) {
  const liveSeconds = Math.max(
    usage.liveAudioSeconds,
    nonNegative(connectedLiveAudioSeconds),
  );
  const uncachedInputTokens = Math.max(
    0,
    usage.captionInputTokens - usage.captionCachedInputTokens,
  );
  const liveTranscription =
    (liveSeconds / 60) * GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE;
  const transcription =
    (usage.transcriptionAudioSeconds / 60) * GPT_TRANSCRIBE_USD_PER_MINUTE;
  const captionGeneration =
    (uncachedInputTokens / 1_000_000) * CAPTION_INPUT_USD_PER_MILLION_TOKENS +
    (usage.captionCachedInputTokens / 1_000_000) *
      CAPTION_CACHED_INPUT_USD_PER_MILLION_TOKENS +
    (usage.captionOutputTokens / 1_000_000) *
      CAPTION_OUTPUT_USD_PER_MILLION_TOKENS;

  return {
    liveTranscription,
    transcription,
    captionGeneration,
    total: liveTranscription + transcription + captionGeneration,
  };
}

export function formatEstimatedUsd(value: number) {
  return `$${value.toFixed(value < 0.1 ? 5 : 4)}`;
}
