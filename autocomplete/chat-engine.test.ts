import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionEngine, parseSseContentDelta } from "./chat-engine";
import { fimUserContent } from "./postprocess";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const context = { prefix: "p", suffix: "s", modelId: "model-a", maxTokens: 128 };

test("parses visible content and ignores reasoning-only events", () => {
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [{ delta: { content: "code" } }] })), "code");
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [{ text: "legacy" }] })), "legacy");
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [{ delta: { reasoning_content: "secret" } }] })), "");
  assert.equal(parseSseContentDelta("not json"), "");
});

test("streams a cleaned completion with the provider prompt and headers", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const engine = new ChatCompletionEngine({
    label: "Example",
    url: "https://example.test/chat",
    headers: { Authorization: "Bearer test-key" },
    timeoutMs: 1_000,
    buildPrompt: (ctx) => ({ messages: [{ role: "user", content: fimUserContent(ctx.prefix, ctx.suffix) }], extra: { reasoning_effort: "none" } }),
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "```js\nout" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hidden" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: ".append\n```" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    },
  });
  const result = await engine.complete(context, new AbortController().signal);
  assert.equal(result.text, "out.append");
  const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
  assert.equal(requests[0]?.url, "https://example.test/chat");
  assert.deepEqual([body.model, body.stream, body.max_tokens, body.temperature, body.reasoning_effort], ["model-a", true, 128, 0, "none"]);
  assert.equal((requests[0]?.init.headers as Record<string, string>).Authorization, "Bearer test-key");
});

test("hides error bodies and returns nothing for superseded requests", async () => {
  const failing = new ChatCompletionEngine({
    label: "Example", url: "https://example.test", headers: {}, timeoutMs: 1_000,
    buildPrompt: () => ({ messages: [] }),
    fetcher: async () => new Response("private prompt echo", { status: 500 }),
  });
  await assert.rejects(failing.complete(context, new AbortController().signal), (error: unknown) =>
    error instanceof Error && error.message === "Example completion request failed (500)");

  const controller = new AbortController();
  const aborted = new ChatCompletionEngine({
    label: "Example", url: "https://example.test", headers: {}, timeoutMs: 1_000,
    buildPrompt: () => ({ messages: [] }),
    fetcher: async () => { controller.abort(); throw new DOMException("aborted", "AbortError"); },
  });
  assert.deepEqual((await aborted.complete(context, controller.signal)).text, undefined);
});
