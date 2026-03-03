# SuperDoc

A document editing and rendering library for the web.

## Architecture: Rendering

SuperDoc uses its own rendering pipeline — **ProseMirror is NOT used for visual output**.

```
PM Doc (hidden) → pm-adapter → FlowBlock[] → layout-engine → Layout[] → DomPainter → DOM
```

- `PresentationEditor` wraps a hidden ProseMirror `Editor` instance for document state and editing commands
- The hidden Editor's contenteditable DOM is never shown to the user
- **DomPainter** (`layout-engine/painters/dom/`) owns all visual rendering
- Style-resolved properties (backgrounds, fonts, borders, etc.) must flow through `pm-adapter` → DomPainter, not through PM decorations

### Where visual changes go

| Change | Where |
|--------|-------|
| How something looks | `pm-adapter/` (data) + `painters/dom/` (rendering) |
| Style resolution | `style-engine/` |
| Editing behavior | `super-editor/src/extensions/` |

**Do NOT** add ProseMirror decoration plugins for visual styling — DomPainter handles rendering.

### State Communication

State flows from super-editor → Layout Engine via:
- `PresentationEditor.ts` listens to editor events (`super-editor/src/core/presentation-editor/`)
- Calls DomPainter methods to update state
- DomPainter re-renders with new state

## Project Structure

```
packages/
  superdoc/          Main entry point (npm: superdoc)
  react/             React wrapper (@superdoc-dev/react)
  super-editor/      ProseMirror editor (@superdoc/super-editor)
  layout-engine/     Layout & pagination pipeline
    contracts/       - Shared type definitions
    pm-adapter/      - ProseMirror → Layout bridge
    layout-engine/   - Pagination algorithms
    layout-bridge/   - Pipeline orchestration
    painters/dom/    - DOM rendering
    style-engine/    - OOXML style resolution
  ai/                AI integration
  collaboration-yjs/ Collaboration server
shared/              Internal utilities
e2e-tests/           Playwright tests
tests/visual/        Visual regression tests (Playwright + R2 baselines)
```

## Where to Look

| Task | Location |
|------|----------|
| React integration | `packages/react/src/SuperDocEditor.tsx` |
| Editing features | `super-editor/src/extensions/` |
| Presentation mode visuals | `layout-engine/painters/dom/src/renderer.ts` |
| DOCX import/export | `super-editor/src/core/super-converter/` |
| Style resolution | `layout-engine/style-engine/` |
| Main entry point (Vue) | `superdoc/src/SuperDoc.vue` |
| Visual regression tests | `tests/visual/` (see its CLAUDE.md) |
| Document API contract | `packages/document-api/src/contract/operation-definitions.ts` |
| Adding a doc-api operation | See `packages/document-api/README.md` § "Adding a new operation" |

## Style Resolution Boundary

**The importer stores raw OOXML properties. The style-engine resolves them at render time.**

- The converter (`super-converter/`) should only parse and store what is explicitly in the XML (inline properties, style references). It must NOT resolve style cascades, conditional formatting, or inherited properties.
- The style-engine (`layout-engine/style-engine/`) is the single source of truth for cascade logic. All style resolution (defaults → table style → conditional formatting → inline overrides) happens here.
- Both rendering systems call the style-engine to compute final visual properties.

**Why**: Resolving styles during import bakes them into node attributes as inline properties. On export, these get written as direct formatting instead of style references, losing the original document intent.

## When to Modify Which System

- **Visual rendering**: Modify `pm-adapter/` (to feed data) and/or `painters/dom/` (to render it)
- **Style resolution**: Modify `style-engine/` — called by pm-adapter during conversion
- **Editing commands/behavior**: Modify `super-editor/src/extensions/`
- **State bridging**: Modify `PresentationEditor.ts`

## Document API Contract

The `packages/document-api/` package uses a contract-first pattern with a single source of truth.

- **`operation-definitions.ts`** — canonical object defining every operation's key, metadata, member path, reference doc path, and group. All downstream maps are projected from this file automatically.
- **`operation-registry.ts`** — type-level registry mapping each operation to its `input`, `options`, and `output` types.
- **`invoke.ts`** — `TypedDispatchTable` validates dispatch wiring against the registry at compile time.

Adding a new operation touches 4 files: `operation-definitions.ts`, `operation-registry.ts`, `invoke.ts` (dispatch table), and the implementation. See `packages/document-api/README.md` for the full guide.

Do NOT hand-edit `COMMAND_CATALOG`, `OPERATION_MEMBER_PATH_MAP`, `OPERATION_REFERENCE_DOC_PATH_MAP`, or `REFERENCE_OPERATION_GROUPS` — they are derived from `OPERATION_DEFINITIONS`.

## JSDoc types

Many packages use `.js` files with JSDoc `@typedef` for type definitions (e.g., `packages/superdoc/src/core/types/index.js`). These typedefs ARE the published type declarations — `vite-plugin-dts` generates `.d.ts` files from them.

- **Keep JSDoc typedefs in sync with code.** If a function destructures `{ a, b, c }`, the `@typedef` must include all three properties. Missing properties become type errors for consumers.
- **Verify types after adding parameters.** When adding a parameter to a function, update its `@typedef` or `@param` JSDoc. Build with `pnpm run --filter superdoc build:es` and check the generated `.d.ts` in `dist/`.
- **Workspace packages don't publish types.** `@superdoc/common`, `@superdoc/contracts`, etc. are private. If a public API references their types, those types must be inlined or resolved through path aliases — consumers can't resolve workspace packages.

## Commands

- `pnpm build` - Build all packages
- `pnpm test` - Run tests
- `pnpm dev` - Start dev server (from examples/)
- `pnpm run generate:all` - Generate all derived artifacts (schemas, SDK clients, tool catalogs, reference docs)

## Generated Artifacts

These directories are produced by `pnpm run generate:all`:

| Directory | In git? | What it contains |
|-----------|---------|-----------------|
| `packages/document-api/generated/` | No (gitignored) | Agent tool schemas, JSON schemas, manifest |
| `apps/cli/generated/` | No (gitignored) | SDK contract JSON exported from CLI metadata |
| `packages/sdk/langs/node/src/generated/` | No (gitignored) | Node SDK generated client code |
| `packages/sdk/langs/python/superdoc/generated/` | No (gitignored) | Python SDK generated client code |
| `packages/sdk/tools/*.json` | No (gitignored) | Tool catalogs for all providers (catalog.json, tools.openai.json, etc.) |
| `apps/docs/document-api/reference/` | Yes (Mintlify deploys from git) | Reference doc pages generated from contract |

After a fresh clone, run `pnpm run generate:all` before working on SDK, CLI, or doc-api code.

Note: `packages/sdk/tools/__init__.py` is a manual file (Python package marker) and stays committed.

## Header/Footer Editing System

Headers and footers use a **sibling host architecture** — editing happens in a separate ProseMirror editor mounted alongside (not inside) the static DomPainter decoration.

### How it works

1. **Static rendering**: `DomPainter.renderDecorationSection()` renders headers/footers as `<div class="superdoc-page-header">` / `<div class="superdoc-page-footer">` with `pointer-events: none`
2. **Double-click activation**: `EditorInputManager.#handleDoubleClick()` → `hitTestHeaderFooterRegion()` → `HeaderFooterSessionManager.activateRegion()`
3. **Editor host creation**: `EditorOverlayManager.showEditingOverlay()` creates a sibling `<div class="superdoc-header-editor-host">` with `pointer-events: auto` and `z-index: 10`
4. **PM editor mount**: A separate ProseMirror editor instance is created and mounted inside the editor host
5. **Exit**: Escape key or clicking body → `exitMode()` → hides editor host, shows static decoration

### Key files

| File | Purpose |
|------|---------|
| `super-editor/src/core/presentation-editor/pointer-events/EditorInputManager.ts` | Double-click handler, pointer event routing during H/F editing |
| `super-editor/src/core/presentation-editor/header-footer/HeaderFooterSessionManager.ts` | Session state machine (body ↔ header ↔ footer), region hit testing |
| `super-editor/src/core/header-footer/EditorOverlayManager.ts` | Creates/positions editor host elements, manages border lines, height tracking |
| `super-editor/src/core/header-footer/HeaderFooterRegistry.ts` | Creates and caches PM editor instances per header/footer variant |
| `layout-engine/painters/dom/src/renderer.ts` | `renderDecorationSection()` for static rendering, `updateVirtualWindow()` for page virtualization |
| `super-editor/src/core/presentation-editor/PresentationEditor.ts` | Orchestrates rerender cycle, focus save/restore during H/F editing |

### Known pitfalls

- **Focus loss during rerender (SD-1993)**: `updateVirtualWindow()` re-orders page elements via DOM mutations. Moving a page element causes `blur` on any focused descendant (the H/F PM editor). Fix: cursor-based DOM reconciliation that skips moves for elements already in position, plus focus save/restore safety net in `PresentationEditor.ts`.
- **Click swallowing in H/F mode**: `#handlePointerDown` calls `event.preventDefault()` when a H/F region is detected (to prevent native selection before double-click). If `#handleClickInHeaderFooterMode` doesn't intercept clicks within the active editing region, cursor repositioning breaks. The check must pass clicks through when the hit region matches the currently-editing mode.
- **ResizeObserver triggers rerender**: `EditorOverlayManager.startEditorHeightTracking()` fires `scheduleRerender()` on height changes, which can cause the focus-loss chain above.

## PMIRS Integration (fork: Luthamm/ADEX)

This is a customized fork of upstream `superdoc-dev/superdoc`. PMIRS (`/Code/pmirs/frontend`) consumes this as a pre-built tarball from GitHub Releases.

### Release workflow

1. Build: `cd packages/superdoc && pnpm run pack:es` → produces `superdoc.tgz`
2. Release: `gh release create v1.16.X superdoc.tgz --repo Luthamm/ADEX --title "v1.16.X" --notes "description"`
3. Update pmirs: In `pmirs/frontend/package.json`, change the version URL: `"@harbour-enterprises/superdoc": "https://github.com/Luthamm/ADEX/releases/download/v1.16.X/superdoc.tgz"`
4. Clear cache + install: `npm cache clean --force && npm i`

### How PMIRS wraps SuperDoc

- **Main component**: `pmirs/frontend/src/components/superdoc/SuperDocEditor.tsx` (~1400 lines)
- **Document loading**: `useDocumentLoader` hook fetches DOCX blob + editor content + header/footer content from API
- **SuperDoc init**: `new SuperDoc({ selector, toolbar, documentMode, user, onCommentsUpdate, ... })` — user comes from JWT token
- **Comments bridge**: `handleCommentsUpdate` callback receives SuperDoc comment events and calls `useCreateComment` / `useDeleteComment` API mutations
- **Header/footer data**: Loaded from API as `headerContent`/`footerContent`, passed during save but NOT during init (SuperDoc manages them internally from the DOCX)
- **No custom H/F UI**: All header/footer editing is delegated entirely to SuperDoc

### Tracked changes import (current limitation)

SuperDoc emits rich tracked change data via `onCommentsUpdate`:
- `comment.trackedChange` = `true`
- `comment.trackedChangeText` = description (e.g. "Inserted: 'hello'")
- `comment.trackedChangeType` = "insertion" / "deletion"
- `comment.deletedText` = the deleted text
- `comment.importedAuthor` = `{ name: "Author Name (imported)" }`
- `comment.creatorName` / `comment.creatorEmail` = original DOCX author

The pmirs backend `create_comment` only stores `author_user_id` (FK to User table) — no custom author name/email columns. Imported tracked change author info is embedded in the content string as a workaround until backend support is added.

### Upstream sync

- This fork is ~40 commits behind `superdoc-dev/superdoc` main
- Merge upstream periodically: `git fetch upstream && git merge upstream/main`
- Key upstream contributors: Nick Bernal (architecture), Tadeu Tupinamba (layout/pointer fixes), Matt Connelly (click positioning)
- After merging, rebuild and push a new release for pmirs to consume

### Dev server

- `pnpm dev` starts Vite dev server at `localhost:9094` with full source resolution (no build step needed)
- `SuperdocDev.vue` at `packages/superdoc/src/dev/components/` is the dev harness (pulled from upstream)
- Dev server imports `@superdoc/common` from `shared/common/` (resolved via pnpm workspace symlinks)
- If Vite cache gets stale: `rm -rf packages/superdoc/node_modules/.vite && pnpm dev`
