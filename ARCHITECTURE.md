# SuperDoc Architecture

Technical documentation for understanding SuperDoc internals, the extension system, and DOCX import pipeline.

---

## Dual Rendering System

SuperDoc uses **two independent rendering systems** that work in parallel:

| System | Package | Purpose | Technology |
|--------|---------|---------|------------|
| **Editing Mode** | `super-editor` | Interactive document editing | ProseMirror + decorations |
| **Presentation Mode** | `layout-engine` | Paginated viewing/printing | DomPainter + virtualization |

**Key insight**: Visual changes often need to be implemented in **both** systems.

### Project Structure

```
packages/
  superdoc/              Main entry point (npm: superdoc)
  super-editor/          ProseMirror editor (@superdoc/super-editor)
    src/
      core/
        super-converter/ DOCX import/export
        presentation-editor/ Bridge to layout-engine
      extensions/        68 extensions (bold, tables, etc.)
  layout-engine/
    contracts/           Shared types (FlowBlock, Layout)
    pm-adapter/          ProseMirror → FlowBlocks conversion
    layout-engine/       Pagination algorithms
    layout-bridge/       Pipeline orchestration
    painters/dom/        DOM rendering + virtualization
    style-engine/        OOXML style resolution
```

---

## How Extensions Work

Extensions live in `packages/super-editor/src/extensions/`. Each extension follows this pattern:

```javascript
import { Mark } from '@tiptap/core'

export const MyExtension = Mark.create({
  name: 'my-extension',

  // Configuration options
  addOptions() {
    return { defaultValue: true }
  },

  // Node/mark attributes stored in PM document
  addAttributes() {
    return {
      color: { default: null }
    }
  },

  // How to parse from HTML
  parseHTML() {
    return [{ tag: 'span[data-color]' }]
  },

  // How to render to HTML
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },

  // Editor commands (editor.commands.setColor())
  addCommands() {
    return {
      setColor: (color) => ({ commands }) => {
        return commands.setMark(this.name, { color })
      }
    }
  },

  // ProseMirror plugins for behavior
  addPmPlugins() {
    return [/* PM plugins */]
  },
})
```

### Key Extensions

| Extension | Location | Purpose |
|-----------|----------|---------|
| `table/` | `extensions/table/` | Table node definition |
| `table-row/` | `extensions/table-row/` | Row structure |
| `table-cell/` | `extensions/table-cell/` | Cell structure + merging |
| `paragraph/` | `extensions/paragraph/` | Text paragraphs |
| `track-changes/` | `extensions/track-changes/` | Revision tracking |

---

## DOCX Import Pipeline

This is the complete flow from a `.docx` file to rendered document:

```
DOCX File (ArrayBuffer)
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  SuperConverter.parseFromXml()                               │
│  Location: super-converter/SuperConverter.js:260             │
│  • Unzips DOCX                                               │
│  • Parses XML files (document.xml, styles.xml, etc.)         │
│  • Builds convertedXml dictionary                            │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  createDocumentJson() (v2 importer)                          │
│  Location: super-converter/v2/importer/docxImporter.js:110   │
│  • Calls v3 NodeHandlers for each XML element                │
│  • Builds ProseMirror JSON structure                         │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  v3 Handlers (element-specific translators)                  │
│  Location: super-converter/v3/handlers/w/                    │
│  • Each XML element type has its own handler                 │
│  • Tables: v3/handlers/w/tbl/tbl-translator.js               │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  ProseMirror Document (EditorState)                          │
│  • JSON converted to PM Node via createDocument()            │
│  • Editor ready for user interaction                         │
└──────────────────────────────────────────────────────────────┘
       │
       ▼ (for Presentation Mode)
┌──────────────────────────────────────────────────────────────┐
│  toFlowBlocks()                                              │
│  Location: layout-engine/pm-adapter/src/internal.ts          │
│  • Converts PM document → FlowBlock[] array                  │
│  • Tables: pm-adapter/src/converters/table.ts                │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  incrementalLayout()                                         │
│  Location: layout-engine/layout-bridge/src/layout-pipeline.ts│
│  • Pagination algorithm                                      │
│  • Returns Layout[] with positioned page fragments           │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  DomPainter                                                  │
│  Location: layout-engine/painters/dom/src/renderer.ts        │
│  • Renders to virtualized DOM                                │
│  • Only visible pages in viewport are mounted                │
└──────────────────────────────────────────────────────────────┘
```

---

## Table Import: Deep Dive

Tables are one of the most complex structures. Here's exactly where each step happens:

### Step 1: DOCX XML → ProseMirror JSON

**Location:** `packages/super-editor/src/core/super-converter/v3/handlers/w/tbl/`

| File | Purpose |
|------|---------|
| `tbl-translator.js` | Main table handler (~150 lines) |
| `tblGrid-translator.js` | Column widths from `<w:tblGrid>` |
| `tblPr-translator.js` | Table properties (borders, width, styles) |
| `tr-translator.js` | Table rows |
| `tc-translator.js` | Table cells |
| `tcPr-translator.js` | Cell properties (merge, width, borders) |

**What tbl-translator.js does (line 65+):**

1. Extracts `<w:tblPr>` (table properties)
2. Extracts `<w:tblGrid>` (column width definitions)
3. Resolves borders from table styles
4. Processes each `<w:tr>` row
5. For each row, processes `<w:tc>` cells
6. Handles cell merging (rowspan/colspan)

**Output structure:**
```javascript
{
  type: 'table',
  attrs: {
    tableProperties: {
      tableStyleId,      // Style reference
      justification,     // Alignment
      tableLayout,       // 'fixed' | 'autofit'
      tableWidth,        // { value, type }
      borders,           // Border definitions
      cellMargins,       // Default cell padding
    },
    grid: {
      colWidths: [{ col: 1440 }, { col: 1440 }]  // in twips
    }
  },
  content: [/* rows */]
}
```

### Step 2: ProseMirror → FlowBlocks

**Location:** `packages/layout-engine/pm-adapter/src/converters/table.ts`

**Key function - normalizeRowHeight() (line 116):**
```typescript
// Converts DOCX twips to pixels
// CRITICAL: 277 twips ≈ 18.5px, NOT 277px
function normalizeRowHeight(height) {
  // Handles: 'exact', 'atLeast', 'auto'
}
```

**What happens:**
- Converts PM table node → `TableBlock`
- Parses each cell's attributes (borders, padding, alignment)
- Handles rowspan/colspan for merged cells
- Converts paragraphs within cells

### Step 3: Rendering

**Location:** `packages/layout-engine/painters/dom/src/table/`

- Receives pre-computed Layout with positioned fragments
- Maps computed coordinates to CSS positioning
- Applies borders, padding, backgrounds

---

## Unit Conversions (Critical for Tables)

DOCX uses **twips** (1/20 of a point). Common conversions:

| DOCX Value | Unit | Pixels |
|------------|------|--------|
| 1440 | twips | 96px (1 inch) |
| 20 | twips | 1.33px |
| 277 | twips | 18.5px |

Conversion formula: `pixels = twips / 15`

**Where conversions happen:**
- `tblGrid-translator.js` - Column widths
- `table.ts` (pm-adapter) - Row heights (normalizeRowHeight)
- Various cell property handlers

---

## State Flow: Editing → Presentation

1. **User edits in ProseMirror**
   - Transaction updates PM document
   - Decorations show visual feedback

2. **PresentationEditor listens**
   - Location: `super-editor/src/core/presentation-editor/PresentationEditor.ts:2806`
   - Calls `toFlowBlocks()` on document change

3. **Layout computed**
   - `incrementalLayout()` calculates pagination
   - Returns positioned fragments

4. **DOM updated**
   - DomPainter re-renders affected pages
   - Virtualization keeps only visible pages in DOM

---

## Table Cell Shading

Cell background colors come from the `<w:shd>` element in DOCX.

### Shading Attributes

| Attribute | Purpose |
|-----------|---------|
| `w:fill` | Direct hex color (e.g., "FF0000") |
| `w:themeFill` | Theme color reference (e.g., "accent1") |
| `w:themeFillTint` | Tint modifier (hex 00-FF) |
| `w:themeFillShade` | Shade modifier (hex 00-FF) |
| `w:val` | Pattern type (e.g., "clear", "pct25") |

### Import Flow

1. `shd-translator.js` extracts all attributes
2. `legacy-handle-table-cell-node.js` calls `resolveShadingFillColor()`
3. Theme colors resolved via `themeColors` from document theme
4. Result stored in `background.color` attribute

### Key Files

| File | Purpose |
|------|---------|
| `helpers.js` | `resolveShadingFillColor()` - resolves fill color |
| `legacy-handle-table-cell-node.js` | Applies background to cell |
| `docxImporter.js` | `getThemeColorPalette()` extracts theme |

### Theme Color Resolution

Theme colors are resolved by:
1. Looking up `themeFill` in the document's theme palette
2. Applying tint: `result = color + (255 - color) * (1 - tintValue/255)`
3. Applying shade: `result = color * (shadeValue/255)`

---

## Table Resize Handles

Interactive column resizing uses a Vue overlay component.

### Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| `TableResizeOverlay.vue` | `super-editor/src/components/` | Renders handles |
| `SuperEditor.vue` | `super-editor/src/components/` | Hover detection |

### How It Works

1. Mouse moves over table → `isNearColumnBoundary()` checks proximity
2. If near boundary, overlay becomes visible
3. Overlay positions itself relative to `.super-editor` container
4. Handles positioned using `data-table-boundaries` metadata from table
5. Drag updates column widths via ProseMirror transaction

### Positioning

The overlay uses `getBoundingClientRect()` to position relative to `.super-editor`:
```javascript
const superEditor = tableElement.closest('.super-editor');
const containerRect = superEditor.getBoundingClientRect();
const left = tableRect.left - containerRect.left + superEditor.scrollLeft;
```

### Key Files

| File | Purpose |
|------|---------|
| `TableResizeOverlay.vue` | Handle rendering and drag logic |
| `renderTableFragment.ts` | Embeds `data-table-boundaries` metadata |

---

## Editing Cell Background

Cell background can be changed via `editor.commands.setCellBackground(color)`.

### Toolbar Integration

The "Cell Background" button appears in the toolbar when cursor is in a table:
- Defined in `defaultItems.js` as `cellBackground`
- Uses color picker from `color-dropdown-helpers.js`
- Enabled/disabled via `isInTable()` check in `super-toolbar.js`

### Command Flow

1. User selects color from dropdown
2. `setCellBackground` command called (defined in `table.js`)
3. Command calls `setCellAttr('background', { color })`
4. ProseMirror transaction updates cell attribute
5. Both editing and presentation modes re-render

---

## Debugging Table Issues

### Common Problems and Where to Look

| Problem | Likely Location |
|---------|-----------------|
| Columns wrong width | `tblGrid-translator.js`, `tblPr-translator.js` |
| Cells not merging | `tc-translator.js`, `tcPr-translator.js` |
| Borders missing | `tblPr-translator.js`, style resolution |
| Rows wrong height | `table.ts` (normalizeRowHeight in pm-adapter) |
| Table layout broken | `table.ts` (pm-adapter converter) |
| Cell shading missing | `helpers.js` (resolveShadingFillColor), `legacy-handle-table-cell-node.js` |
| Theme colors not resolving | `docxImporter.js` (themeColors param), `helpers.js` |
| Resize handles misaligned | `TableResizeOverlay.vue` (updateOverlayRect) |
| Rendering issues | `painters/dom/src/table/` |

### Test Files

| Test File | Purpose |
|-----------|---------|
| `tbl-translator.test.js` | DOCX XML → PM JSON |
| `tbl-translator.integration.test.js` | Full import pipeline |
| `table.test.ts` (pm-adapter) | PM → FlowBlocks |
| `table.test.ts` (painters/dom) | Rendering |

### Debug Steps

1. **Check XML parsing:**
   ```javascript
   // In tbl-translator.js, log the incoming XML
   console.log(JSON.stringify(xmlElement, null, 2))
   ```

2. **Check PM JSON output:**
   ```javascript
   // After import, inspect the document
   console.log(JSON.stringify(editor.getJSON(), null, 2))
   ```

3. **Check FlowBlocks:**
   ```javascript
   // In pm-adapter table.ts, log the output
   console.log(JSON.stringify(tableBlock, null, 2))
   ```

---

## Key Files Reference

| Task | File |
|------|------|
| Main entry | `packages/superdoc/src/SuperDoc.vue` |
| Editor core | `packages/super-editor/src/core/Editor.ts` |
| DOCX converter | `packages/super-editor/src/core/super-converter/SuperConverter.js` |
| Table import | `packages/super-editor/src/core/super-converter/v3/handlers/w/tbl/` |
| Table PM→FlowBlocks | `packages/layout-engine/pm-adapter/src/converters/table.ts` |
| Table rendering | `packages/layout-engine/painters/dom/src/table/` |
| Presentation bridge | `packages/super-editor/src/core/presentation-editor/PresentationEditor.ts` |
| Style resolution | `packages/layout-engine/style-engine/src/` |

---

## Commands

```bash
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm dev        # Start dev server (from examples/)
```
