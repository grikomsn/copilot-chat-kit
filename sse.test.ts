import assert from "node:assert/strict";
import test from "node:test";
import { parseSseBlock, SseFramer } from "./sse";

test("frames fragmented blocks with event names and multi-line data", () => {
  const framer = new SseFramer();
  assert.deepEqual(framer.push("event: delta\ndata: a\n"), []);
  assert.deepEqual(framer.push("data: b\r\n\r\n: comment\n\ndata: tail"), [{ event: "delta", data: "a\nb" }]);
  assert.deepEqual(framer.finish(), [{ data: "tail" }]);
  assert.deepEqual(framer.finish(), []);
});

test("drops comment-only and empty blocks", () => {
  assert.equal(parseSseBlock(": keep-alive"), undefined);
  assert.equal(parseSseBlock("event: ping"), undefined);
  assert.deepEqual(parseSseBlock("data:   x  "), { data: "x" });
});
