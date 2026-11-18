import assert from "node:assert/strict";
import test from "node:test";
import { cleanSuggestion, completionReasoningEffort, fimUserContent, stripCodeFence, stripSpecialTokens } from "./postprocess";

test("builds one FIM user message", () => {
  assert.equal(fimUserContent("before", "after"), "<|fim_prefix|>before<|fim_suffix|>after<|fim_middle|>");
});

test("strips surrounding, dangling, and orphan fences", () => {
  assert.equal(stripCodeFence("```python\n    out.append(x)\n```"), "    out.append(x)");
  assert.equal(stripCodeFence("```\nplain\nfence\n```"), "plain\nfence");
  assert.equal(stripCodeFence("```python\n(a - low) / (high - low)"), "(a - low) / (high - low)");
  assert.equal(stripCodeFence("    out.append(x)\n```"), "    out.append(x)");
  assert.equal(stripCodeFence("\n\n```python\n    out.append(x)\n```"), "    out.append(x)");
  assert.equal(stripCodeFence("```python\n```js\nx\n```\n```"), "```js\nx\n```");
});

test("leaves unfenced text alone and only trims leading newlines on request", () => {
  assert.equal(stripCodeFence("\n    return x"), "\n    return x");
  assert.equal(stripCodeFence("\n\n    out.append(x)", { trimLeadingNewlines: true }), "    out.append(x)");
  assert.equal(stripCodeFence("use `x = 1` inline"), "use `x = 1` inline");
  const inline = "```python\ncode\n```\nmore";
  assert.equal(stripCodeFence(inline), inline);
});

test("strips echoed special tokens and empty suggestions", () => {
  assert.equal(stripSpecialTokens("<|file_separator|>    out.append(x)<|fim_middle|>"), "    out.append(x)");
  assert.equal(stripSpecialTokens("a <| b"), "a <| b");
  assert.equal(cleanSuggestion("<|fim_middle|>```\nx = 1\n```"), "x = 1");
  assert.equal(cleanSuggestion("<|fim_middle|>  "), undefined);
});

test("picks a valid reasoning-off effort", () => {
  assert.equal(completionReasoningEffort(["none", "high"]), "none");
  assert.equal(completionReasoningEffort(["low", "high"]), "low");
  assert.equal(completionReasoningEffort(undefined), undefined);
});
