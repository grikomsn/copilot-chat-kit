# copilot-chat-kit

Provider-neutral building blocks shared by the Copilot Chat provider extensions
(openai-oauth, ampersand-bridge, grok, inco, ollama-cloud, opencode, orvix).

The kit is **vendored**, not published: `npm run sync -- <repo> [...]` copies
`src/` into each extension's `src/kit/` and writes `src/kit/kit.lock.json`. The
vendored `kit-integrity.test.ts` fails an extension's `npm test` when a kit file
is edited in place, so every change lands here first and is re-synced. This
keeps every extension free of runtime dependencies.

## Modules

| Module | What it owns |
| --- | --- |
| `unicode` | Lone-surrogate-free request JSON and text joining |
| `errors` | `messageOf`, context-overflow hint, one sanitized HTTP error policy |
| `retry` | Pre-stream retry with per-provider transient-status policies |
| `stream` | Total + idle request deadlines and incremental body reading |
| `sse`, `chat-completions` | SSE framing; Chat Completions parsing, tool-call merging, completion validation |
| `messages` | VS Code history → Chat Completions messages (tool ordering, tool-result images, reasoning replay) |
| `history-trim` | Oldest-turn trimming for chat and Responses formats |
| `response-writer` | Thinking segments, held usage parts, fallback tool ids |
| `usage-payload` | The `"usage"` data part Copilot Chat reads |
| `token-count`, `context-size`, `pricing` | Picker and estimate helpers |
| `credentials` | Native-entry API key registry and fingerprints |
| `remote-snapshot` | Persisted stale-while-revalidate snapshots (models.dev) |
| `autocomplete/*` | Inline suggestion provider, debounce, windowing, FIM cleanup, SSE engine |
| `vscode/*.d.ts` | Host API augmentations shipped by VS Code 1.125 |

Provider quirks (auth flows, dialect extensions, cost tables, usage domains)
stay in each extension and configure these modules through options.

## Workflow

```bash
npm ci && npm test
npm run sync -- ../openai-oauth-copilot-chat ../ampersand-bridge-copilot-chat \
  ../grok-copilot-chat ../inco-copilot-chat ../ollama-cloud-copilot-chat \
  ../opencode-copilot-chat ../orvix-copilot-chat
```
