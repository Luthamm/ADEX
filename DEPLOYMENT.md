# Deploying Superdoc to PMIRS

This documents how to build the superdoc package and publish it as a GitHub release for consumption by the PMIRS frontend.

## Prerequisites

- pnpm installed
- GitHub CLI (`gh`) authenticated with access to `Luthamm/ADEX`

## Steps

### 1. Build the superdoc tarball

From the ADEX project root:

```bash
pnpm --filter superdoc run pack
```

This runs `build:es` (builds the ES module + types) then `pnpm pack` to produce `packages/superdoc/superdoc.tgz`.

### 2. Create a new GitHub release

Bump the version tag (e.g., `v1.16.8` → `v1.16.9`). The tag must be unique — npm caches tarballs by URL, so reusing the same tag will serve stale builds.

```bash
gh release create v1.16.9 packages/superdoc/superdoc.tgz \
  --title "v1.16.9" \
  --notes "Superdoc build v1.16.9" \
  --repo Luthamm/ADEX
```

### 3. Update the PMIRS frontend

In `pmirs/frontend/package.json`, update the version in the URL:

```json
"@harbour-enterprises/superdoc": "https://github.com/Luthamm/ADEX/releases/download/v1.16.9/superdoc.tgz"
```

### 4. Clean install in the frontend

npm aggressively caches tarball URLs. You must remove the old package, delete the lockfile, clear the cache, and reinstall:

```bash
rm -rf node_modules/@harbour-enterprises/superdoc
rm package-lock.json
npm cache clean --force
npm install
```

## Important: Always bump the version tag

Never overwrite an existing release tag. npm caches the tarball by URL and the `integrity` hash is stored in `package-lock.json`. Even after clearing the cache, the old lockfile hash can cause npm to skip re-downloading. A new tag URL avoids all caching issues.

## Quick reference

| Step | Command |
|------|---------|
| Build | `pnpm --filter superdoc run pack` |
| Release | `gh release create v1.X.X packages/superdoc/superdoc.tgz --title "v1.X.X" --notes "..." --repo Luthamm/ADEX` |
| Install | Update URL in `package.json`, then `rm -rf node_modules/@harbour-enterprises/superdoc && rm package-lock.json && npm cache clean --force && npm install` |
