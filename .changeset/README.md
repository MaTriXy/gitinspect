# Changesets

This repo uses Changesets for release management.

## Common workflow

Create a changeset after making a user-facing change:

```bash
bun run changeset
```

Apply pending version bumps and changelog updates:

```bash
bun run version-packages
```

Publish any released public packages:

```bash
bun run release
```

## Current publishable package

Changesets is intentionally configured for CLI-only publishing in this repo.

- `@gitinspect/cli`

All other workspace packages are ignored by Changesets for now, and the non-CLI workspace packages should remain private. If another package becomes publishable later, remove it from `.changeset/config.json` and update that package's manifest intentionally.

For an extra manual verification step before publishing, you can still run:

```bash
cd apps/cli
bun publish --dry-run
```
