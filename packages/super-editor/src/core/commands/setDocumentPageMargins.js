import { updateSectionMargins, getSectPrMargins } from '@converter/section-properties.js';

/**
 * Update page margins (top/right/bottom/left) for ALL sections in the document.
 * This is the "global margin change" command used by the ruler — it updates every
 * paragraph-level sectPr AND the body-level sectPr so all pages reflect the change.
 *
 * @param {{ topInches?: number; rightInches?: number; bottomInches?: number; leftInches?: number }} params
 * @returns {import('./types/index.js').Command}
 */
export const setDocumentPageMargins =
  ({ topInches, rightInches, bottomInches, leftInches } = {}) =>
  ({ tr, state, editor }) => {
    if (!state || !editor) {
      console.warn('[setDocumentPageMargins] Missing state or editor');
      return false;
    }

    const hasTop = typeof topInches === 'number';
    const hasRight = typeof rightInches === 'number';
    const hasBottom = typeof bottomInches === 'number';
    const hasLeft = typeof leftInches === 'number';
    if (!hasTop && !hasRight && !hasBottom && !hasLeft) {
      console.warn('[setDocumentPageMargins] No margin values provided');
      return false;
    }
    if (
      (hasTop && topInches < 0) ||
      (hasRight && rightInches < 0) ||
      (hasBottom && bottomInches < 0) ||
      (hasLeft && leftInches < 0)
    ) {
      console.warn('[setDocumentPageMargins] Margin values must be >= 0');
      return false;
    }

    const updates = {};
    if (hasTop) updates.topInches = topInches;
    if (hasRight) updates.rightInches = rightInches;
    if (hasBottom) updates.bottomInches = bottomInches;
    if (hasLeft) updates.leftInches = leftInches;

    // 1. Update ALL paragraph-level sectPr nodes
    const paragraphs = [];
    state.doc.descendants((node, nodePos) => {
      if (node.type?.name === 'paragraph' && node.attrs?.paragraphProperties?.sectPr) {
        paragraphs.push({ node, pos: nodePos });
      }
    });

    for (const { node, pos } of paragraphs) {
      const paraProps = node.attrs?.paragraphProperties || null;
      const existingSectPr = paraProps?.sectPr || null;
      if (!existingSectPr) continue;

      const sectPr = JSON.parse(JSON.stringify(existingSectPr));
      try {
        updateSectionMargins({ type: 'sectPr', sectPr }, updates);
      } catch (err) {
        console.error('[setDocumentPageMargins] Failed to update paragraph sectPr:', err);
        continue;
      }

      const resolved = getSectPrMargins(sectPr);
      const normalizedSectionMargins = {
        top: resolved.top ?? null,
        right: resolved.right ?? null,
        bottom: resolved.bottom ?? null,
        left: resolved.left ?? null,
        header: resolved.header ?? null,
        footer: resolved.footer ?? null,
      };

      const newParagraphProperties = { ...(paraProps || {}), sectPr };
      const nextAttrs = {
        ...node.attrs,
        paragraphProperties: newParagraphProperties,
        sectionMargins: normalizedSectionMargins,
      };

      tr.setNodeMarkup(tr.mapping.map(pos), undefined, nextAttrs, node.marks);
    }

    // 2. Update body-level sectPr (final section)
    const docAttrs = state.doc.attrs ?? {};
    const converter = editor.converter ?? null;
    const baseBodySectPr = docAttrs.bodySectPr || converter?.bodySectPr || null;
    const bodySectPr =
      baseBodySectPr != null
        ? JSON.parse(JSON.stringify(baseBodySectPr))
        : { type: 'element', name: 'w:sectPr', elements: [] };

    try {
      updateSectionMargins({ type: 'sectPr', sectPr: bodySectPr }, updates);
    } catch (err) {
      console.error('[setDocumentPageMargins] Failed to update body sectPr:', err);
      return false;
    }

    // Persist to converter and keep converter.pageStyles.pageMargins in sync
    if (converter) {
      converter.bodySectPr = bodySectPr;
      if (!converter.pageStyles) converter.pageStyles = {};
      if (!converter.pageStyles.pageMargins) converter.pageStyles.pageMargins = {};
      const pageMargins = converter.pageStyles.pageMargins;
      const resolved = getSectPrMargins(bodySectPr);
      if (resolved.top != null) pageMargins.top = resolved.top;
      if (resolved.right != null) pageMargins.right = resolved.right;
      if (resolved.bottom != null) pageMargins.bottom = resolved.bottom;
      if (resolved.left != null) pageMargins.left = resolved.left;
      if (resolved.header != null) pageMargins.header = resolved.header;
      if (resolved.footer != null) pageMargins.footer = resolved.footer;
    }

    // Write updated body sectPr onto the doc attrs so layout sees it immediately
    tr.setDocAttribute('bodySectPr', bodySectPr);

    tr.setMeta('forceUpdatePagination', true);
    return true;
  };
