# Changesets

Each pull request that changes kit behavior should include a changeset:

```bash
npm run changeset
```

Choose `patch`, `minor`, or `major`, then describe the change as the consuming
extensions will see it. The release workflow collects pending changesets into a
version pull request. Merging that pull request tags the release (`vX.Y.Z`) and
creates a matching GitHub release; the extensions then bump their `src/kit`
submodule to that tag.

Documentation-only and internal maintenance changes may use an empty
changeset:

```bash
npm run changeset -- --empty
```
