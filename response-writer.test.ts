import assert from "node:assert/strict";
import test from "node:test";
import { ChatEventReporter, parseToolArguments, ResponseWriter, type ResponsePartConstructors } from "./response-writer";
import { normalizeTokenUsage, providerUsagePayload } from "./usage-payload";

class Text { constructor(readonly value: string) {} }
class Thinking { constructor(readonly value: string | string[], readonly id?: string, readonly metadata?: Record<string, unknown>) {} }
class Tool { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class Data { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }
const parts = { LanguageModelTextPart: Text, LanguageModelThinkingPart: Thinking,
  LanguageModelToolCallPart: Tool, LanguageModelDataPart: Data } as unknown as ResponsePartConstructors;

function reporter(output: unknown[], requestId: string, onUsage: (raw: Record<string, unknown>) => void = () => {}): ChatEventReporter {
  const writer = new ResponseWriter({ report: (part) => output.push(part) }, parts, "example", requestId);
  return new ChatEventReporter(writer, { label: "Example", toUsagePayload: (raw) => providerUsagePayload(normalizeTokenUsage(raw)), onUsage });
}

test("reports reasoning before text and closes each thinking segment once with a stable id", () => {
  const output: unknown[] = [];
  const events = reporter(output, "request-a");
  events.report({ text: "answer", reasoning: "last reasoning" });
  events.report({ reasoning: "next reasoning" });
  events.report({ toolCalls: [{ id: "", name: "read", arguments: "{}" }] });
  events.finish();
  assert.deepEqual(output.map((part) => (part as object).constructor.name), ["Thinking", "Thinking", "Text", "Thinking", "Thinking", "Tool"]);
  assert.deepEqual((output[1] as Thinking).metadata, { vscode_reasoning_done: true });
  const ids = output.filter((part): part is Thinking => part instanceof Thinking).map((part) => part.id);
  assert.deepEqual(new Set(ids), new Set(["example-thinking-request-a"]));
});

test("EOF closes thinking and fallback call IDs are request scoped", () => {
  const output: unknown[] = [];
  const first = reporter(output, "one");
  const second = reporter(output, "two");
  first.report({ reasoning: "pending" });
  first.finish(); first.finish();
  first.report({ toolCalls: [{ id: "", name: "read", arguments: "{}" }, { id: "", name: "read", arguments: "{}" }] });
  second.report({ toolCalls: [{ id: "", name: "read", arguments: "{}" }] });
  const tools = output.filter((part): part is Tool => part instanceof Tool);
  assert.equal(new Set(tools.map((tool) => tool.callId)).size, 3);
  assert.equal(output.filter((part) => part instanceof Thinking).length, 2);
});

test("usage during thinking waits for the segment close so deltas stay mergeable", () => {
  const output: unknown[] = [];
  const seen: unknown[] = [];
  const events = reporter(output, "request-u", (raw) => seen.push(raw));
  events.report({ reasoning: "Son" });
  events.report({ usage: { prompt_tokens: 10, completion_tokens: 4 } });
  events.report({ reasoning: "ar still" });
  events.report({ usage: { prompt_tokens: 20, completion_tokens: 9 } });
  events.report({ text: "answer" });
  events.finish();
  assert.deepEqual(output.map((part) => (part as object).constructor.name), ["Thinking", "Thinking", "Thinking", "Data", "Data", "Text"]);
  const data = output.filter((part): part is Data => part instanceof Data);
  assert.deepEqual(data.map((part) => part.mimeType), ["usage", "usage"]);
  assert.deepEqual(data.map((part) => JSON.parse(new TextDecoder().decode(part.data)).completion_tokens), [4, 9]);
  assert.equal(seen.length, 2);
});

test("skips thinking without host support and empty usage payloads", () => {
  const output: unknown[] = [];
  const noThinking = { ...parts, LanguageModelThinkingPart: undefined } as ResponsePartConstructors;
  const writer = new ResponseWriter({ report: (part) => output.push(part) }, noThinking, "example", "r");
  writer.thinking("hidden");
  writer.usage(undefined);
  writer.usage({});
  writer.text("visible");
  writer.report(new Data(new Uint8Array(), "image/png") as never, { closesThinking: false });
  writer.finish();
  assert.deepEqual(output.map((part) => (part as object).constructor.name), ["Text", "Data"]);
  assert.equal(writer.isThinking, false);
});

test("tool arguments keep objects, wrap other JSON, and reject malformed JSON", () => {
  assert.deepEqual(parseToolArguments('{"a":1}', "Example"), { a: 1 });
  assert.deepEqual(parseToolArguments("", "Example"), {});
  assert.deepEqual(parseToolArguments("[1]", "Example"), { value: [1] });
  assert.deepEqual(parseToolArguments("3", "Example"), { value: 3 });
  assert.throws(() => parseToolArguments("{", "Example", "read"), /Example returned invalid arguments for read/);
});
