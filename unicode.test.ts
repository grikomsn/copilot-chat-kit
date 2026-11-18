import assert from "node:assert/strict";
import test from "node:test";
import { joinTextParts, stringifyWellFormedJson, wellFormedText } from "./unicode";

test("joins parts with newlines but keeps surrogate pairs split across parts", () => {
  const emoji = "😀";
  assert.equal(joinTextParts(["a", "b"]), "a\nb");
  assert.equal(joinTextParts([`x${emoji[0]}`, `${emoji[1]}y`]), `x${emoji}y`);
});

test("replaces lone surrogates only", () => {
  assert.equal(wellFormedText("ok 😀"), "ok 😀");
  assert.equal(wellFormedText("bad \uD800 end \uDC00"), "bad � end �");
});

test("normalizes nested strings and keys before JSON encoding", () => {
  const encoded = stringifyWellFormedJson({ ["k\uD800"]: ["v\uDC00", { deep: "\uD83D" }], ok: 1 });
  assert.deepEqual(JSON.parse(encoded), { "k�": ["v�", { deep: "�" }], ok: 1 });
  assert.equal(encoded.includes("\\ud800"), false);
});
