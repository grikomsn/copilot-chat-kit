import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { trimChatHistoryToFit } from "./history-trim";
import { CONTINUE_NOTE, convertChatMessages, messageText, TOOL_IMAGES_NOTE, type ChatConversionOptions, type MessagePartClasses } from "./messages";

class TextPart { constructor(readonly value: string) {} }
class ThinkingPart { constructor(readonly value: string | string[]) {} }
class ToolCallPart { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class ToolResultPart { constructor(readonly callId: string, readonly content: unknown[]) {} }
class DataPart { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }
const classes = {
  LanguageModelTextPart: TextPart,
  LanguageModelThinkingPart: ThinkingPart,
  LanguageModelToolCallPart: ToolCallPart,
  LanguageModelToolResultPart: ToolResultPart,
  LanguageModelDataPart: DataPart,
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
} as unknown as MessagePartClasses;

function message(content: unknown[], role = 1): vscode.LanguageModelChatRequestMessage {
  return { role, content, name: undefined } as unknown as vscode.LanguageModelChatRequestMessage;
}

function convert(input: vscode.LanguageModelChatRequestMessage[], options: Partial<ChatConversionOptions> = {}) {
  return convertChatMessages(input, classes, { label: "Example", imageInput: false, ...options });
}

const png = new Uint8Array([0, 1, 2]);

test("keeps parallel tool results ahead of accompanying user text", () => {
  const converted = convert([
    message([new TextPart("Read files")]),
    message([new ToolCallPart("one", "read", {}), new ToolCallPart("two", "read", {})], 2),
    message([new ToolResultPart("one", [new TextPart("first")]), new TextPart("Summarize both"),
      new ToolResultPart("two", [new TextPart("second")])]),
  ]);
  assert.deepEqual(converted.map((item) => item.role), ["user", "assistant", "tool", "tool", "user"]);
  assert.deepEqual(converted.slice(2, 4).map((item) => item.tool_call_id), ["one", "two"]);
  assert.equal(converted[4].content, "Summarize both");
  const trimmed = trimChatHistoryToFit(converted, 1).items;
  assert.deepEqual(trimmed.slice(1, 4).map((item) => item.role), ["assistant", "tool", "tool"]);
});

test("does not insert an empty user message before a tool result and continues assistant-first history", () => {
  assert.deepEqual(convert([message([new ToolResultPart("one", [new TextPart("result")])])]),
    [{ role: "tool", tool_call_id: "one", content: "result" }]);
  assert.deepEqual(convert([message([new TextPart("hi")], 2)]).map((item) => item.content), [CONTINUE_NOTE, "hi"]);
  assert.deepEqual(convert([]), [{ role: "user", content: "" }]);
});

test("preserves split emoji in text and nested tool results", () => {
  const input = message([new TextPart("status \uD83D"), new TextPart("\uDFE2"),
    new ToolResultPart("one", [new TextPart("file \uD83D"), new TextPart("\uDE80"),
      new ToolResultPart("nested", [new TextPart("\uD83D"), new TextPart("\uDCCB")])])]);
  const converted = convert([input]);
  assert.equal(converted[0].content, "file 🚀\n📋");
  assert.equal(converted[1].content, "status 🟢");
  assert.equal(messageText(input, classes), "status 🟢\nfile 🚀\n📋");
});

test("normalizes tool arguments and enforces image support", () => {
  const [converted] = convert([
    message([new TextPart("anchor")]),
    message([new ToolCallPart("one", "read", { text: "\uD800", nested: ["🟢", "\uDC00"] })], 2),
  ]).slice(1);
  assert.deepEqual(JSON.parse(converted.tool_calls![0].function.arguments), { text: "�", nested: ["🟢", "�"] });
  const image = message([new DataPart(png, "image/png")]);
  assert.throws(() => convert([image]), /selected Example model does not advertise image/);
  assert.match(JSON.stringify(convert([image], { imageInput: true })), /data:image\/png;base64,AAEC/);
  assert.equal(convert([image], { unsupportedImages: "omit" })[0].content, "[image/png data omitted]");
});

test("forwards tool-result images to vision models after every parallel call settles", () => {
  const history = [
    message([new TextPart("draw")]),
    message([new ToolCallPart("a", "img", {}), new ToolCallPart("b", "img", {})], 2),
    message([new ToolResultPart("a", [new TextPart("done a"), new DataPart(png, "image/png")])]),
    message([new ToolResultPart("b", [new DataPart(png, "image/png")])]),
  ];
  const vision = convert(history, { imageInput: true });
  assert.deepEqual(vision.map((item) => item.role), ["user", "assistant", "tool", "tool", "user"]);
  const trailing = vision[4].content as { type: string; text?: string }[];
  assert.equal(trailing[0].text, TOOL_IMAGES_NOTE);
  assert.equal(trailing.filter((part) => part.type === "image_url").length, 2);
  assert.equal(vision[2].content, "done a");

  const textOnly = convert(history);
  assert.deepEqual(textOnly.map((item) => item.role), ["user", "assistant", "tool", "tool"]);
  assert.equal(textOnly[3].content, "[image/png data omitted]");
  assert.equal(convert(history, { imageInput: true, toolResultImages: false })[3].content, "[image/png data omitted]");
});

test("optionally replays reasoning, caps inline images, and decodes text data", () => {
  const assistant = message([new ThinkingPart(["plan", " more"]), new TextPart("answer")], 2);
  const replayed = convert([message([new TextPart("q")]), assistant], { replayReasoning: true });
  assert.equal(replayed[1].reasoning_content, "plan\n more");
  assert.equal(convert([message([new TextPart("q")]), assistant])[1].reasoning_content, undefined);

  const big = message([new DataPart(new Uint8Array(10), "image/png")]);
  assert.match(String(convert([big], { imageInput: true, maxInlineImageBytes: 5 })[0].content), /Image omitted: 10 bytes/);
  const attachment = message([new DataPart(new TextEncoder().encode("file body"), "text/plain")]);
  assert.equal(convert([attachment])[0].content, "file body");
});
