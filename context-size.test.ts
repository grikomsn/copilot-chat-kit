import assert from "node:assert/strict";
import test from "node:test";
import { contextSizeOptions, resolveContextCap, resolveContextSize } from "./context-size";

test("offers context tiers below the registered input limit", () => {
  assert.deepEqual(contextSizeOptions(1_048_576)?.map((option) => option.value), ["auto", 65_536, 131_072, 200_000, 1_048_576]);
  assert.deepEqual(contextSizeOptions(1_048_576)?.map((option) => option.label), ["Auto", "64K", "128K", "200K", "Maximum"]);
  assert.equal(contextSizeOptions(65_536), undefined);
  assert.equal(contextSizeOptions(32_000), undefined);
});

test("resolves the effective context cap from the selected tier", () => {
  assert.equal(resolveContextCap(131_072, 1_048_576), 131_072);
  assert.equal(resolveContextCap(1_500_000, 1_048_576), undefined);
  assert.equal(resolveContextCap(0, 1_048_576), undefined);
  assert.equal(resolveContextCap(65_536, 65_536), undefined);
});

test("reads the context size from picker configuration", () => {
  assert.equal(resolveContextSize({ contextSize: 131_072 }), 131_072);
  assert.equal(resolveContextSize({ contextSize: 0 }), 0);
  assert.equal(resolveContextSize({ contextSize: "131072" }), 0);
  assert.equal(resolveContextSize(undefined), 0);
});
