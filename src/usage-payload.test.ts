import assert from "node:assert/strict";
import test from "node:test";
import { encodeUsagePayload, normalizeTokenUsage, providerUsagePayload } from "./usage-payload";

test("builds a compact OpenAI-shaped payload with optional details", () => {
  assert.deepEqual(providerUsagePayload({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }), {
    prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
  });
  assert.deepEqual(providerUsagePayload({
    promptTokens: 10, completionTokens: 5, cachedTokens: 4, cacheWriteTokens: 2, reasoningTokens: 3, costUsd: 0.01,
  }), {
    prompt_tokens: 10,
    completion_tokens: 5,
    prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
    completion_tokens_details: { reasoning_tokens: 3 },
    copilotCredits: 0.01,
  });
  assert.equal(providerUsagePayload({ cachedTokens: 3 }), undefined);
});

test("normalizes chat, responses, and gateway aliases", () => {
  assert.deepEqual(normalizeTokenUsage({
    prompt_tokens: 140, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 1 },
  }), { promptTokens: 140, completionTokens: 2, totalTokens: 142, cachedTokens: 100, reasoningTokens: 1 });
  assert.deepEqual(normalizeTokenUsage({ input_tokens: 7, output_tokens: 3, total_tokens: 11, input_tokens_details: { cached_tokens: 2 } }),
    { promptTokens: 7, completionTokens: 3, totalTokens: 11, cachedTokens: 2 });
  assert.deepEqual(normalizeTokenUsage({ prompt_tokens: -1, completion_tokens: "2" }), {});
  assert.deepEqual(JSON.parse(new TextDecoder().decode(encodeUsagePayload({ prompt_tokens: 1 }))), { prompt_tokens: 1 });
});
