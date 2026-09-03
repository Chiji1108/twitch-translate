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
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
        }),
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return Response.json(
        {
          error:
            (data as { error?: { message?: string } } | null)?.error?.message ??
            "Realtime文字起こしセッションを準備できませんでした",
        },
        { status: response.status },
      );
    }

    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    return Response.json(
      {
        error:
          reason instanceof Error
            ? reason.message
            : "Realtime文字起こしAPIへ接続できませんでした",
      },
      { status: 502 },
    );
  }
}
