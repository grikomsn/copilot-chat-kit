# copilot-chat-kit

Provider-neutral building blocks shared by the Copilot Chat provider extensions
(openai-oauth, ampersand-bridge, grok, inco, ollama-cloud, opencode, orvix).

Each extension consumes the kit as a **git submodule at `src/kit`**, so imports
stay `./kit/<module>` and the extension's own `tsc`, tests, and VSIX packaging
compile it alongside its sources. The pinned submodule commit is the version;
nothing is published to npm and the extensions keep zero runtime dependencies.

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

## Constraints for kit code

- No runtime `vscode` import outside `autocomplete/provider.ts`; inject VS Code
  classes (`ResponsePartConstructors`, `MessagePartClasses`) so modules test in
  plain Node.
- No runtime dependencies. Only `node:` built-ins and the extension host.
- Strict TypeScript compatible with each extension's `tsconfig.json`
  (`module: Node16`, `target: ES2023`, `rootDir: src`).
- Colocated `node:test` coverage; the extensions run these tests too.

## Workflow

```bash
npm ci && npm test                          # in this repository

# adding the kit to an extension
git submodule add https://github.com/grikomsn/copilot-chat-kit.git src/kit

# picking up a new kit version in an extension
git submodule update --remote src/kit && npm test
git commit -am "Update copilot-chat-kit"

# fresh clones of an extension
git clone --recurse-submodules <extension-repo>   # or: git submodule update --init
```

Change kit code here (or inside an extension's `src/kit` checkout, then push
from there), never as an uncommitted edit an extension ships.
