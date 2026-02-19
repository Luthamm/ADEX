// @ts-check
import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { cellAround } from './cellAround.js';

/**
 * Find the table node that contains the given resolved position.
 * @param {import('prosemirror-model').ResolvedPos} $pos
 * @returns {import('prosemirror-model').Node | null}
 */
function tableFromCell($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === 'table') return $pos.node(d);
  }
  return null;
}

/**
 * Get the depth of the table node containing the given resolved position.
 * @param {import('prosemirror-model').ResolvedPos} $pos
 * @returns {number}
 */
function tableDepth($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === 'table') return d;
  }
  return -1;
}

/**
 * Check if two resolved positions are in the same table.
 * @param {import('prosemirror-model').ResolvedPos} $a
 * @param {import('prosemirror-model').ResolvedPos} $b
 * @returns {boolean}
 */
function inSameTable($a, $b) {
  const dA = tableDepth($a);
  const dB = tableDepth($b);
  return dA > 0 && dA === dB && $a.before(dA) === $b.before(dB);
}

/**
 * Resolve a mouse event to a cell position in the document.
 * @param {import('prosemirror-view').EditorView} view
 * @param {MouseEvent} event
 * @returns {import('prosemirror-model').ResolvedPos | null}
 */
function cellAtEvent(view, event) {
  const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!pos) return null;
  return cellAround(view.state.doc.resolve(pos.pos));
}

/**
 * Creates a ProseMirror plugin that provides Word-like table cell selection behavior.
 *
 * - Single click on a cell (from outside the table): selects the cell (CellSelection)
 * - Double-click on a cell: enters edit mode (TextSelection / word selection)
 * - Click + drag across cells: multi-cell CellSelection
 * - When in edit mode, clicks within the same table behave normally (text cursor)
 *
 * @returns {Plugin}
 */
export function tableCellSelectionPlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        if (!(state.selection instanceof CellSelection)) return DecorationSet.empty;
        /** @type {Decoration[]} */
        const cells = [];
        state.selection.forEachCell((node, pos) => {
          cells.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: 'selectedCell',
              style: 'box-shadow: inset 0 0 0 9999px rgba(200, 200, 255, 0.4);',
            }),
          );
        });
        return DecorationSet.create(state.doc, cells);
      },

      handleDOMEvents: {
        mousedown(view, event) {
          // Let modifier keys pass through for shift-click extend, etc.
          if (event.shiftKey || event.ctrlKey || event.metaKey) return false;

          // Only handle left button
          if (event.button !== 0) return false;

          // Double-click or triple-click: let PM handle natively (enters edit mode)
          if (event.detail >= 2) return false;

          const $cell = cellAtEvent(view, event);
          if (!$cell) return false;

          const { selection } = view.state;

          // Already in edit mode (TextSelection) inside the same table — let PM handle normally
          if (selection instanceof TextSelection && tableFromCell($cell)) {
            const $sel = selection.$head;
            if (inSameTable($sel, $cell)) return false;
          }

          // CellSelection active in the same table — enter edit mode on click
          if (selection instanceof CellSelection) {
            const $anchor = cellAround(selection.$anchorCell);
            if ($anchor && inSameTable($anchor, $cell)) {
              // Place text cursor at the clicked position
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (pos) {
                const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.pos));
                view.dispatch(tr);
              }
              // Update PM's click tracking so double-click still works
              updateLastClick(view, event);
              event.preventDefault();
              return true;
            }
          }

          // Default: select the cell with CellSelection and set up drag tracking
          const tr = view.state.tr.setSelection(CellSelection.create(view.state.doc, $cell.pos));
          view.dispatch(tr);

          // Update PM's click tracking so subsequent double-click is detected
          updateLastClick(view, event);
          event.preventDefault();

          // Set up drag-to-select
          startDragSelection(view, $cell);

          return true;
        },
      },
    },
  });
}

/**
 * Update ProseMirror's internal click tracking so double/triple click detection
 * still works after we intercept a mousedown.
 * @param {import('prosemirror-view').EditorView} view
 * @param {MouseEvent} event
 */
function updateLastClick(view, event) {
  // @ts-ignore — accessing internal PM state for click counting
  if (view.input) {
    // @ts-ignore
    view.input.lastClick = { time: Date.now(), x: event.clientX, y: event.clientY, type: 'mouse' };
  }
}

/**
 * Set up document-level listeners for drag-to-select across cells.
 * @param {import('prosemirror-view').EditorView} view
 * @param {import('prosemirror-model').ResolvedPos} $anchor - The anchor cell
 */
function startDragSelection(view, $anchor) {
  let dragging = false;
  const root = view.root;

  function onMouseMove(/** @type {MouseEvent} */ event) {
    const $cell = cellAtEvent(view, event);
    if (!$cell) return;
    if (!inSameTable($anchor, $cell)) return;

    // Only create multi-cell selection if we've moved to a different cell
    if ($cell.pos !== $anchor.pos) {
      dragging = true;
      const sel = CellSelection.create(view.state.doc, $anchor.pos, $cell.pos);
      const tr = view.state.tr.setSelection(sel);
      view.dispatch(tr);
    }
  }

  function onMouseUp() {
    root.removeEventListener('mousemove', onMouseMove);
    root.removeEventListener('mouseup', onMouseUp);
  }

  root.addEventListener('mousemove', onMouseMove);
  root.addEventListener('mouseup', onMouseUp);
}
