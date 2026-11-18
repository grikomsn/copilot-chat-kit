# Repository guidance

## Scope and setup

- These instructions apply to the entire repository.
- This is a strict-TypeScript library of provider-neutral building blocks for the Copilot Chat provider extensions (openai-oauth, ampersand-bridge, grok, inco, ollama-cloud, opencode, orvix). Use Node.js 22+ and npm; `package-lock.json` is authoritative.
- Install from a clean checkout with `npm ci`.
- The extensions consume this repository as a git submodule at `src/kit` and compile it with their own `tsconfig.json` (`module: Node16`, `target: ES2023`, `rootDir: src`). Sources live at the repository root so extension imports stay `./kit/<module>`.

## Code map

- `unicode.ts`, `errors.ts`, `retry.ts`, `stream.ts`: request hygiene, the sanitized error policy, pre-stream retry, and total/idle deadlines.
- `sse.ts`, `chat-completions.ts`: SSE framing and Chat Completions parsing, tool-call merging, and completion validation.
- `messages.ts`, `history-trim.ts`: VS Code history conversion and oldest-turn trimming.
- `response-writer.ts`, `usage-payload.ts`: VS Code response parts, thinking segments, and the `"usage"` data part.
- `token-count.ts`, `context-size.ts`, `pricing.ts`, `credentials.ts`, `remote-snapshot.ts`: picker, estimate, credential, and models.dev helpers.
- `autocomplete/`: inline suggestion provider, debounce, windowing, FIM cleanup, and the Chat Completions engine.
- `vscode/`: VS Code API augmentations shipped by the 1.125 host.
- Tests are colocated as `**/*.test.ts`; the extensions run them too. `out/` is generated.

## Commands

- `npm run compile` — clean and type-check into `out/`.
- `npm test` or `npm run check` — compile and run all Node test files.
- `npm run changeset` — record a behavior change for the next release tag.

## Working agreements

- Keep changes focused and follow the strict TypeScript style: explicit public types, small helpers, double quotes, and two-space indentation.
- No runtime dependencies. Only `node:` built-ins and the extension host.
- No runtime `vscode` import outside `autocomplete/provider.ts`; inject VS Code classes (`ResponsePartConstructors`, `MessagePartClasses`) so modules test in plain Node.
- Provider quirks stay in the extensions and configure kit modules through options; do not add provider names, endpoints, or cost tables here.
- Never log or surface API keys, prompts, tool arguments, raw response bodies, or account data.
- Add or update colocated `node:test` coverage for behavior changes; network paths use injected fakes.
- A behavior change must keep every consuming extension's `npm test` passing; check affected extensions with the change checked out at their `src/kit`.
- Do not commit generated `out/`, logs, or unrelated dependency churn.

## Before handing off

- Run `npm run check`.
- Add a Changeset with `npm run changeset` for behavior changes. Documentation, tests, and repository-maintenance-only changes do not require one.
- After merging, bump `src/kit` in each consuming extension in its own pull request.
