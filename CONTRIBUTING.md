# Contributing

Thanks for helping improve copilot-chat-kit, the shared building blocks of the
Copilot Chat provider extensions.

## Before opening work

- Use [Discussions](https://github.com/grikomsn/copilot-chat-kit/discussions/categories/q-a) for usage and integration questions.
- Search existing issues before filing a bug or feature request.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.
- Provider-specific behavior (authentication, model catalogs, pricing tables, usage domains) belongs in the extension that owns it, not here.
- Keep changes focused. Open an issue first when a proposal changes shared request, error, or credential behavior that every extension inherits.

## Development

Use Node.js 22 or newer:

```bash
npm ci
npm test
```

Kit modules must stay free of runtime dependencies and of a runtime `vscode` import (inject VS Code classes instead; `autocomplete/provider.ts` is the only exception). Add or update colocated `node:test` coverage when behavior changes. Do not commit `out/`, `.env` files, or API keys.

Behavior changes need a Changeset:

```bash
npm run changeset
```

Documentation, tests, and repository-maintenance-only changes do not need one.

## Verifying against the extensions

The extensions consume the kit as a git submodule at `src/kit`. Before merging a behavior change, check out your branch inside each affected extension's `src/kit` and run its `npm test`. After merging, bump the submodule in every extension with `git submodule update --remote src/kit` in a pull request there.

## Pull requests

A pull request should:

- Explain the problem and the chosen solution, and name the affected extensions
- Stay limited to one coherent change
- Pass tests here and in the affected extensions
- Update documentation when modules, options, or workflows change
- Avoid unrelated dependency or formatting churn

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). For contribution questions not suited to Discussions, contact [griko@nibras.co](mailto:griko@nibras.co).
