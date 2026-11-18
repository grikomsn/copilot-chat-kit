import assert from "node:assert/strict";
import test from "node:test";
import { apiKeyFromConfiguration, credentialReference, Credentials } from "./credentials";

test("fingerprints are stable, short, and ignore surrounding whitespace", () => {
  assert.equal(credentialReference("key-1"), credentialReference("  key-1\n"));
  assert.match(credentialReference("key-1"), /^[0-9a-f]{16}$/);
  assert.notEqual(credentialReference("key-1"), credentialReference("key-2"));
});

test("extracts trimmed keys and honors a shape validator", () => {
  assert.equal(apiKeyFromConfiguration({ apiKey: "  abc " }), "abc");
  assert.equal(apiKeyFromConfiguration({ apiKey: "" }), undefined);
  assert.equal(apiKeyFromConfiguration({ apiKey: 3 }), undefined);
  assert.equal(apiKeyFromConfiguration({ apiKey: "sk-1" }, (key) => key.startsWith("live_")), undefined);
  assert.equal(apiKeyFromConfiguration({ apiKey: "live_1" }, (key) => key.startsWith("live_")), "live_1");
});

test("tracks the most recently registered key even within one millisecond", () => {
  const credentials = new Credentials();
  const first = credentials.register("first");
  const second = credentials.register("second");
  assert.equal(credentials.activeApiKey(), "second");
  credentials.register("first");
  assert.equal(credentials.activeApiKey(), "first");
  assert.equal(credentials.activeCredentialRef(), first);
  assert.equal(credentials.keyForCredential(second), "second");
  assert.equal(credentials.has("missing"), false);
  assert.equal(new Credentials().activeApiKey(), undefined);
});
