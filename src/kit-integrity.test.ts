/**
 * Fails when a vendored kit file was edited in place. Change the canonical
 * copilot-chat-kit repository instead and run its sync script.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";

interface KitLock {
  readonly source: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, string>>;
}

function findKitDirectory(start: string): { kitDir: string; canonical: boolean } | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "src", "kit", "kit.lock.json"))) return { kitDir: join(dir, "src", "kit"), canonical: false };
    if (existsSync(join(dir, "src", "kit-integrity.test.ts")) && existsSync(join(dir, "scripts", "sync.mjs"))) {
      return { kitDir: join(dir, "src"), canonical: true };
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path, root);
    return entry.name === "kit.lock.json" ? [] : [relative(root, path).split(sep).join("/")];
  });
}

export function hashKitFile(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex");
}

test("vendored kit files match the canonical lock", (context) => {
  const found = findKitDirectory(__dirname);
  assert.ok(found, "src/kit/kit.lock.json is missing; run the copilot-chat-kit sync script");
  if (found.canonical) {
    context.skip("canonical kit repository");
    return;
  }
  const lock = JSON.parse(readFileSync(join(found.kitDir, "kit.lock.json"), "utf8")) as KitLock;
  const actual = listFiles(found.kitDir).sort();
  assert.deepEqual(actual, Object.keys(lock.files).sort(), "src/kit has added or removed files; re-run the kit sync");
  for (const file of actual) {
    const hash = hashKitFile(readFileSync(join(found.kitDir, file), "utf8"));
    assert.equal(hash, lock.files[file], `src/kit/${file} differs from copilot-chat-kit@${lock.commit}; edit the canonical kit and re-sync`);
  }
});
