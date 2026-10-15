import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIChatBody } from "./openai-chat";

const messages = [{ role: "user", content: "ping" }];

describe("buildOpenAIChatBody", () => {
  it("sends reasoning_effort none and temperature for gpt-6", () => {
    const body = buildOpenAIChatBody({
      model: "gpt-6-luna",
      temperature: 0.25,
      maxCompletionTokens: 900,
      messages,
      stream: true,
    });
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.temperature, 0.25);
    assert.equal(body.max_completion_tokens, 900);
    assert.equal(body.reasoning_effort, "none");
    assert.equal(body.stream, true);
    assert.equal("max_tokens" in body, false);
  });

  it("omits reasoning_effort for gpt-4o-mini and still sends temperature", () => {
    const body = buildOpenAIChatBody({
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxCompletionTokens: 700,
      messages,
      responseFormat: { type: "json_object" },
    });
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.temperature, 0.3);
    assert.equal(body.max_completion_tokens, 700);
    assert.equal("reasoning_effort" in body, false);
    assert.equal("max_tokens" in body, false);
    assert.equal("stream" in body, false);
    assert.deepEqual(body.response_format, { type: "json_object" });
  });
});
