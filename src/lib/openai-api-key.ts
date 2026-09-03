export function getOpenAIApiKey(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function missingApiKeyResponse(details?: Record<string, unknown>) {
  return Response.json(
    {
      error: "OpenAI API Keyを入力してください",
      ...(details ? { details } : {}),
    },
    {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
