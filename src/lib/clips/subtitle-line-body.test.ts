import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIChatBody } from "../openai-chat";
import { buildSubtitleLineChatBody } from "../../../backend-clips/subtitle-lines.js";

const messages = [{ role: "user", content: "0 bonjour" }];

describe("subtitle line chat body", () => {
  it("matches buildOpenAIChatBody for gpt-6-luna", () => {
    assert.deepEqual(
      buildSubtitleLineChatBody("gpt-6-luna", messages),
      buildOpenAIChatBody({
        model: "gpt-6-luna",
        temperature: 0,
        maxCompletionTokens: 400,
        messages,
        responseFormat: { type: "json_object" },
      })
    );
  });

  it("matches buildOpenAIChatBody for gpt-4o-mini", () => {
    const body = buildSubtitleLineChatBody("gpt-4o-mini", messages);
    assert.deepEqual(
      body,
      buildOpenAIChatBody({
        model: "gpt-4o-mini",
        temperature: 0,
        maxCompletionTokens: 400,
        messages,
        responseFormat: { type: "json_object" },
      })
    );
    assert.equal("reasoning_effort" in body, false);
    assert.equal("max_tokens" in body, false);
  });
});
