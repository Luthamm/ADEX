import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const SECTION_LOCK_KEY = new PluginKey('sectionLock');

/**
 * Extract heading level from a paragraph node's styleId.
 * @param {import('prosemirror-model').Node} node
 * @returns {number|null} heading level (1-9) or null
 */
function getHeadingLevel(node) {
  const styleId = node.attrs?.paragraphProperties?.styleId;
  if (!styleId) return null;
  const match = /^Heading(\d+)$/.exec(styleId);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Walk top-level nodes, identify heading sections, call predicate, return locked ranges.
 * A section = heading + all content until next heading of same or higher level, or doc end.
 * Content before the first heading is never a section.
 *
 * @param {import('prosemirror-model').Node} doc
 * @param {function} predicate - receives { text: string, level: number, index: number }
 * @returns {Array<{from: number, to: number}>}
 */
function computeLockedRanges(doc, predicate) {
  const headings = [];
  let headingIndex = 0;

  doc.forEach((node, offset) => {
    const level = getHeadingLevel(node);
    if (level !== null) {
      headings.push({
        level,
        text: node.textContent.trim(),
        index: headingIndex++,
        from: offset,
        end: offset + node.nodeSize,
      });
    }
  });

  const ranges = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const shouldLock = predicate({
      text: heading.text,
      level: heading.level,
      index: heading.index,
    });

    if (!shouldLock) continue;

    // Section ends at the next heading of same or higher (lower number) level, or doc end
    let sectionEnd = doc.content.size;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= heading.level) {
        sectionEnd = headings[j].from;
        break;
      }
    }

    ranges.push({ from: heading.end, to: sectionEnd });
  }

  return ranges;
}

/**
 * Check if a range [from, to] overlaps any locked range.
 */
function isRangeLocked(ranges, from, to) {
  for (const range of ranges) {
    if (from < range.to && to > range.from) return true;
  }
  return false;
}

/**
 * Build decorations that add `sd-section-locked` class to locked top-level nodes.
 */
function buildDecorations(doc, ranges) {
  if (!ranges.length) return DecorationSet.empty;

  const decorations = [];
  doc.forEach((node, offset) => {
    const nodeEnd = offset + node.nodeSize;
    if (isRangeLocked(ranges, offset, nodeEnd)) {
      decorations.push(Decoration.node(offset, nodeEnd, { class: 'sd-section-locked' }));
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Create the section lock plugin.
 * The predicate is read from `editor.options.lockedSectionPredicate`.
 *
 * @param {object} editor - The super-editor Editor instance
 */
export function createSectionLockPlugin(editor) {
  return new Plugin({
    key: SECTION_LOCK_KEY,

    state: {
      init(_, editorState) {
        const predicate = editor?.options?.lockedSectionPredicate;
        if (typeof predicate !== 'function') {
          return { ranges: [], decorations: DecorationSet.empty };
        }
        const ranges = computeLockedRanges(editorState.doc, predicate);
        return { ranges, decorations: buildDecorations(editorState.doc, ranges) };
      },

      apply(tr, pluginState, _oldState, newState) {
        const predicateUpdate = tr.getMeta('sectionLockUpdate');
        if (!tr.docChanged && !predicateUpdate) return pluginState;

        const predicate = editor?.options?.lockedSectionPredicate;
        if (typeof predicate !== 'function') {
          return { ranges: [], decorations: DecorationSet.empty };
        }

        const ranges = computeLockedRanges(newState.doc, predicate);
        return { ranges, decorations: buildDecorations(newState.doc, ranges) };
      },
    },

    props: {
      decorations(state) {
        return SECTION_LOCK_KEY.getState(state)?.decorations ?? DecorationSet.empty;
      },

      handleKeyDown(view, event) {
        const { state } = view;
        const { from, to } = state.selection;
        const pluginState = SECTION_LOCK_KEY.getState(state);
        if (!pluginState?.ranges.length) return false;

        const isBackspace = event.key === 'Backspace';
        const isDelete = event.key === 'Delete';
        const isCut = (event.metaKey || event.ctrlKey) && event.key === 'x';

        if (!isBackspace && !isDelete && !isCut) return false;

        let affectedFrom = from;
        let affectedTo = to;
        if (from === to) {
          if (isBackspace && from > 0) affectedFrom = from - 1;
          else if (isDelete && to < state.doc.content.size) affectedTo = to + 1;
        }

        if (isRangeLocked(pluginState.ranges, affectedFrom, affectedTo)) {
          event.preventDefault();
          return true;
        }
        return false;
      },

      handleTextInput(view, from, to, _text) {
        const pluginState = SECTION_LOCK_KEY.getState(view.state);
        if (!pluginState?.ranges.length) return false;
        return isRangeLocked(pluginState.ranges, from, to);
      },

      handlePaste(view) {
        const { from, to } = view.state.selection;
        const pluginState = SECTION_LOCK_KEY.getState(view.state);
        if (!pluginState?.ranges.length) return false;
        return isRangeLocked(pluginState.ranges, from, to);
      },

      handleDrop(view, event) {
        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords);
        if (!pos) return false;

        const pluginState = SECTION_LOCK_KEY.getState(view.state);
        if (!pluginState?.ranges.length) return false;
        return isRangeLocked(pluginState.ranges, pos.pos, pos.pos);
      },
    },

    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;

      const pluginState = SECTION_LOCK_KEY.getState(state);
      if (!pluginState?.ranges.length) return true;

      // Allow the sectionLockUpdate meta through (predicate change)
      if (tr.getMeta('sectionLockUpdate')) return true;

      for (const step of tr.steps) {
        if (step.from === undefined || step.to === undefined) continue;
        if (isRangeLocked(pluginState.ranges, step.from, step.to)) return false;
      }
      return true;
    },
  });
}
