import { describe, expect, test } from "bun:test";
import { getOpenAIApiKey, missingApiKeyResponse } from "./openai-api-key.ts";

describe("getOpenAIApiKey", () => {
  test("Bearerヘッダーから利用者のAPIキーを取り出す", () => {
    const request = new Request("https://example.com/api", {
      headers: { Authorization: "Bearer sk-user-example" },
    });

    expect(getOpenAIApiKey(request)).toBe("sk-user-example");
  });

  test("Bearerヘッダーがなければキーを返さない", () => {
    expect(getOpenAIApiKey(new Request("https://example.com/api"))).toBeNull();
  });
});

describe("missingApiKeyResponse", () => {
  test("未入力を認証エラーとして返す", async () => {
    const response = missingApiKeyResponse();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "OpenAI API Keyを入力してください",
    });
  });
});
