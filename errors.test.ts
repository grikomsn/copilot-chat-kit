import assert from "node:assert/strict";
import test from "node:test";
import { httpError, isAbortError, isRejectedCredential, messageOf, parseErrorBody, ProviderHttpError, withContextOverflowHint } from "./errors";

test("messageOf maps aborts to a friendly message", () => {
  assert.equal(messageOf(new DOMException("aborted", "AbortError")), "Request cancelled or timed out");
  assert.equal(messageOf(new Error("boom")), "boom");
  assert.equal(messageOf("plain"), "plain");
  assert.equal(isAbortError(new DOMException("aborted", "AbortError")), true);
  assert.equal(isAbortError(new Error("x")), false);
});

test("adds recovery instructions for context rejection variants", () => {
  for (const message of [
    "invalid params, context window exceeds limit",
    "context_length_exceeded",
    "maximum context length is 128000 tokens",
    "prompt is too long: 150000 tokens",
    "too many input tokens",
    "input exceeds the context window",
  ]) {
    const original = new Error(message);
    const error = withContextOverflowHint(original) as Error;
    assert.match(error.message, /\/compact/);
    assert.equal(error.cause, original);
    assert.equal(withContextOverflowHint(error), error);
  }
  for (const error of [new Error("HTTP 401"), new Error("quota exceeded"), new Error("fetch failed"), "context_length_exceeded"]) {
    assert.equal(withContextOverflowHint(error), error);
  }
});

test("keeps bounded structured messages and drops unstructured bodies", async () => {
  const structured = await httpError("Request failed", Response.json({ error: { message: "Invalid  key\n", code: "invalid_api_key" } }, { status: 401 }));
  assert.ok(structured instanceof ProviderHttpError);
  assert.equal(structured.message, "Request failed (HTTP 401): Invalid key");
  assert.equal(structured.code, "invalid_api_key");
  assert.equal(isRejectedCredential(structured), true);

  const html = await httpError("Request failed", new Response("<html>private echo</html>", { status: 502 }));
  assert.equal(html.message, "Request failed (HTTP 502)");
  assert.equal(isRejectedCredential(html), false);

  const hidden = await httpError("Request failed", Response.json({ detail: "secret" }, { status: 400 }), { detail: "none" });
  assert.equal(hidden.message, "Request failed (HTTP 400)");

  const long = parseErrorBody(JSON.stringify({ message: "x".repeat(1000) }));
  assert.equal(long.message?.length, 300);
  assert.deepEqual(parseErrorBody(JSON.stringify({ error: "string form", code: "bad code with spaces" })), { message: "string form" });
});
