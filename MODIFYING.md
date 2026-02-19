# Modifying SuperDoc

Practical patterns, conventions, and gotchas for making changes to the codebase. For architectural overview, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Codebase Conventions

### File Patterns

| Convention | Example |
|-----------|---------|
| Extensions | `src/extensions/<name>/<name>.js` — Node/Mark definition |
| Helpers | `src/extensions/<name>/tableHelpers/*.js` or `<name>/helpers/*.js` |
| Tests | Co-located: `feature.test.js` next to `feature.js` |
| `@ts-nocheck` | Most `.js` files start with `// @ts-nocheck` |
| `@ts-check` | Small helper files sometimes use `// @ts-check` |

### Import Aliases

```javascript
import { Node, Attribute } from '@core/index.js';        // super-editor/src/core/
import { isInTable } from '@helpers/isInTable.js';        // super-editor/src/core/helpers/
import { findParentNode } from '@helpers/findParentNode.js';
```

### Extension Builder Pattern

Extensions use a fluent builder (`Node.create()` / `Mark.create()`) with these hooks:

| Hook | Purpose | Returns |
|------|---------|---------|
| `addOptions()` | Default config | `{ key: value }` |
| `addAttributes()` | PM node/mark attrs | `{ attrName: { default, renderDOM, parseDOM } }` |
| `addCommands()` | `editor.commands.*` | Command functions |
| `addShortcuts()` | Keyboard bindings | `{ 'Mod-B': handler }` |
| `addPmPlugins()` | ProseMirror plugins | `Plugin[]` |
| `parseDOM()` | HTML → PM node | `[{ tag: 'div' }]` |
| `renderDOM()` | PM node → HTML | `['div', attrs, 0]` |

### Shortcut Handlers

Shortcut handlers receive `({ editor, state, dispatch, view })` and return `true` (handled) or `false` (pass through).

```javascript
addShortcuts() {
  return {
    Escape: ({ editor }) => {
      // Do something
      return true; // consumed
    },
  };
},
```

---

## ProseMirror Plugin System

### How `handleDOMEvents` Works

Plugins are iterated in registration order via `runCustomHandler()`. The **first plugin to return `true`** stops propagation — later plugins and PM's built-in handlers are skipped.

```
Plugin A (handleDOMEvents.mousedown) → returns false → continues
Plugin B (handleDOMEvents.mousedown) → returns true  → STOPS HERE
Plugin C (handleDOMEvents.mousedown) → never called
PM built-in handlers                 → never called
```

### Plugin Ordering in Tables

```javascript
addPmPlugins() {
  return [
    columnResizing(),        // 1. Resize handles (highest priority)
    tableCellSelectionPlugin(), // 2. Cell click/selection
    tableEditing(),          // 3. Default table behavior (fallback)
  ];
}
```

- `columnResizing()` — intercepts mousedown on resize handles
- `tableEditing()` — handles shift-click extend, decorations; its mousedown handler **never returns true** (always `undefined`), so it never blocks later handlers

### PM Internal Click Tracking

ProseMirror tracks clicks at `view.input.lastClick` for double/triple-click detection. If you intercept `mousedown` with `return true`, PM never updates this counter. You must update it manually:

```javascript
// After intercepting mousedown and returning true:
view.input.lastClick = {
  time: Date.now(),
  x: event.clientX,
  y: event.clientY,
  type: 'mouse',
};
```

### `handleDOMEvents.mousedown` vs `handleClick`

| Approach | Timing | Tradeoff |
|----------|--------|----------|
| `handleDOMEvents.mousedown` | Before PM processes | Can prevent TextSelection flash, but must manage state yourself |
| `handleClick` | After mouseup | Simpler, but PM already set TextSelection (visible flash) |
| `appendTransaction` | After any transaction | Can't distinguish mouse clicks from programmatic changes |

**Prefer `handleDOMEvents.mousedown`** when you need to prevent PM's default selection behavior.

### Event Listeners

Use `view.root` instead of `document` for event listeners — this is shadow DOM safe:

```javascript
const root = view.root;
root.addEventListener('mousemove', handler);
root.addEventListener('mouseup', handler);
```

---

## Table System

### Node Hierarchy

```
table (tableRole: 'table')
  └─ tableRow (tableRole: 'row')
       └─ tableCell (tableRole: 'cell') | tableHeader (tableRole: 'header_cell')
            └─ paragraph, image, nested table, etc.
```

### Key Table Helpers

| Helper | Location | Purpose |
|--------|----------|---------|
| `cellAround($pos)` | `tableHelpers/cellAround.js` | Find cell `ResolvedPos` at a document position |
| `cellWrapping($pos)` | `tableHelpers/cellWrapping.js` | Find the actual cell `Node` at a position |
| `isCellSelection(sel)` | `tableHelpers/isCellSelection.js` | Check if selection is `CellSelection` |
| `isInTable(state)` | `@helpers/isInTable.js` | Check if cursor is inside any table |
| `findParentNode(predicate)` | `@helpers/findParentNode.js` | Walk up from selection to find matching node |

### Selection Types in Tables

| Type | Meaning | How to Create |
|------|---------|---------------|
| `TextSelection` | Normal text cursor inside a cell | `TextSelection.create(doc, pos)` |
| `CellSelection` | One or more cells highlighted | `CellSelection.create(doc, anchorCellPos, headCellPos?)` |
| `NodeSelection` | Entire table selected | Rare — used by `allowTableNodeSelection` |

### Table Attributes

**Table node** (`table.js`):
- `tableProperties` — OOXML properties (borders, width, style, layout, margins, floating)
- `grid` — Column widths: `{ colWidths: [{ col: 1440 }] }` (in twips)

**Row node** (`table-row.js`):
- `rowHeight` — Height in pixels (rendered as inline `style="height: Npx"`)
- `cantSplit` — Prevent row from splitting across pages
- `tableRowProperties` — OOXML row properties (used by layout engine)

**Cell node** (`table-cell.js`):
- `colspan`, `rowspan` — Merge spans
- `colwidth` — Per-column pixel widths (array)
- `background` — `{ color: '#hex' }`
- `borders` — `{ top, bottom, left, right, start, end }` border specs
- `cellMargins` — `{ top, bottom, left, right }` padding
- `verticalAlign` — `'top' | 'center' | 'bottom'`

---

## Table Resize System

### Data Flow

```
layout-table.ts generates boundaries
  → renderTableFragment.ts embeds as data-table-boundaries JSON attribute
    → TableResizeOverlay.vue reads boundaries and renders drag handles
      → SuperEditor.vue detects mouse proximity to boundaries
```

### Boundary Data Format

```json
{
  "columns": [{ "i": 0, "x": 100, "w": 200, "min": 50, "r": true }],
  "rows": [{ "i": 0, "y": 50, "h": 30, "min": 20, "r": true }],
  "segments": [...]
}
```

### Dispatching Resize Transactions

A resize updates both the PM node attribute and the layout engine properties:

```javascript
// Update PM column widths
tr.setNodeMarkup(tablePos, null, {
  ...tableAttrs,
  grid: { colWidths: newWidths },
});

// Also update tableRowProperties for the layout engine
```

### Unit Conversions

```javascript
import { pixelsToTwips, twipsToPixels } from '@core/super-converter/helpers.js';
// 1 inch = 1440 twips = 96 pixels
// pixels = twips / 15
// twips = pixels * 15
```

### After Resize: Invalidate Cache

```javascript
measureCache.invalidate([blockId]);
```

---

## Overlay Components (Vue)

### Pattern

Overlay components (resize handles, selection highlights) follow this pattern:

1. **Position tracking** — Use `requestAnimationFrame` loop to track element position during scroll
2. **Zoom awareness** — Layout coordinates × zoom = screen coordinates; screen delta / zoom = layout delta
3. **Container-relative** — Position relative to `.super-editor` container using `getBoundingClientRect()`

```javascript
// Zoom-aware coordinate conversion
const screenX = layoutX * zoom;
const layoutDelta = screenDelta / zoom;
```

---

## Dual-System Changes

### When to Modify Which System

| Change Type | super-editor | layout-engine | Bridge |
|------------|:---:|:---:|:---:|
| Editing behavior (shortcuts, commands) | ✅ | | |
| Visual decoration (editing mode only) | ✅ | | |
| Presentation rendering | | ✅ | |
| New block type | ✅ | ✅ | ✅ |
| Interactive overlay (resize, selection) | ✅ | ✅ (boundaries) | |
| DOCX import/export | ✅ (super-converter) | | |
| Style resolution | | ✅ (style-engine) | |

### Bridge: PresentationEditor

`super-editor/src/core/presentation-editor/PresentationEditor.ts` listens to editor events and calls DomPainter methods. When adding features that affect both modes, this is where you connect them.

### Presentation Mode Interaction

For mouse/pointer interaction in presentation mode:

| Component | Location | Purpose |
|-----------|----------|---------|
| `EditorInputManager.ts` | `presentation-editor/` | Central pointer event hub, table hit testing |
| `TableSelectionUtilities.ts` | `presentation-editor/` | `shouldUseCellSelection()`, `getCellPosFromTableHit()` |
| `CellSelectionOverlay.ts` | `presentation-editor/` | Blue overlay rectangles for selected cells |

---

## DOCX Import: Adding/Modifying Translators

### Translator Location

```
super-converter/v3/handlers/w/tbl/
  tbl-translator.js       # Table element
  tblPr-translator.js     # Table properties (17 child translators)
  tblGrid-translator.js   # Column width grid
  tr-translator.js        # Table rows
  tc-translator.js        # Table cells
  tcPr-translator.js      # Cell properties
```

### Cell Border Cascade (4 levels)

Cell borders resolve through a cascade. In order of priority:
1. Direct cell borders (`<w:tcBorders>`)
2. Table-level conditional formatting
3. Table-level borders (`<w:tblBorders>`)
4. Table style borders

Resolved in `legacy-handle-table-cell-node.js`.

---

## Layout Engine: Table Pagination

### Key File: `layout-engine/layout-engine/src/layout-table.ts`

| Function | Purpose |
|----------|---------|
| `layoutTableBlock()` | Main entry — paginates a table across pages |
| `findSplitPoint()` | Determines where to break a table for page boundaries |
| `computePartialRow()` | Handles mid-row splitting when `cantSplit` is false |

### Splitting Modes

- **Row-boundary split** — break between rows (preferred)
- **Mid-row split** — break within a row if it doesn't fit and `cantSplit` is false
- **Header repetition** — rows marked `repeatHeader` are repeated on each page

### PM Adapter: `pm-adapter/src/converters/table.ts`

Column width priority:
1. User-edited grid (from resize)
2. PM `colwidth` attribute
3. OOXML grid from import
4. Auto-calculated
