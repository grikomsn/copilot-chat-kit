#!/usr/bin/env node
// Vendors src/ into <repo>/src/kit/ and writes kit.lock.json with content hashes.
// Usage: node scripts/sync.mjs ../openai-oauth-copilot-chat [../other-repo ...]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src");
const targets = process.argv.slice(2);
if (!targets.length) {
  console.error("Usage: node scripts/sync.mjs <repo> [<repo> ...]");
  process.exit(1);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const hash = (content) => createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex");
let commit = "uncommitted";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "src"], { cwd: root, encoding: "utf8" }).trim();
  if (dirty) commit += "-dirty";
} catch { /* not a git checkout */ }

const files = listFiles(source).map((path) => ({ path, name: relative(source, path).split(sep).join("/") })).sort((a, b) => a.name.localeCompare(b.name));
for (const target of targets) {
  const kitDir = join(resolve(target), "src", "kit");
  rmSync(kitDir, { recursive: true, force: true });
  const lock = { source: "copilot-chat-kit", commit, files: {} };
  for (const file of files) {
    const content = readFileSync(file.path, "utf8");
    const destination = join(kitDir, file.name);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    lock.files[file.name] = hash(content);
  }
  writeFileSync(join(kitDir, "kit.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`synced ${files.length} files to ${relative(process.cwd(), kitDir) || kitDir} @ ${commit}`);
}
