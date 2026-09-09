import OpenAI, { APIError } from "openai";
import { getOpenAIApiKey, missingApiKeyResponse } from "@/lib/openai-api-key";
import { PROPER_NOUN_TRANSCRIPTION_GUIDANCE } from "@/lib/transcription-prompt";

type SessionRequest = {
  context?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  const apiKey = getOpenAIApiKey(request);
  if (!apiKey) return missingApiKeyResponse();

  const body = (await request
    .json()
    .catch(() => null)) as SessionRequest | null;
  const context = cleanText(body?.context, 500);
  const prompt = [
    "日本語のライブ配信の音声です。話した内容を日本語のまま文字起こししてください。",
    context ? `配信コンテキスト: ${context}` : "",
    PROPER_NOUN_TRANSCRIPTION_GUIDANCE,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const openai = new OpenAI({ apiKey });
    const clientSecret = await openai.realtime.clientSecrets.create(
      {
        session: {
          type: "transcription",
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              transcription: {
                model: "gpt-live-transcribe",
                prompt,
                languages: ["ja"],
                delay: "minimal",
              },
              turn_detection: null,
            },
          },
        },
        expires_after: { anchor: "created_at", seconds: 60 },
      },
      { signal: request.signal },
    );

    return Response.json(clientSecret, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    const apiError = reason instanceof APIError ? reason : null;
    return Response.json(
      {
        error:
          reason instanceof Error
            ? reason.message
            : "Realtime文字起こしAPIへ接続できませんでした",
        details: apiError
          ? {
              code: apiError.code ?? undefined,
              type: apiError.type,
              param: apiError.param ?? undefined,
              requestId: apiError.requestID ?? undefined,
            }
          : undefined,
      },
      { status: apiError?.status ?? 502 },
    );
  }
}
