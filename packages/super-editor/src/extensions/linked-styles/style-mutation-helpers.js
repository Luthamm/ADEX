// @ts-check
import { translateStyleDefinitions } from '@core/super-converter/v2/importer/docxImporter.js';

/**
 * Update an existing style in the converter's linkedStyles array
 * @param {Object} editor - The editor instance
 * @param {string} styleId - The ID of the style to update
 * @param {Object} updates - Object with { attrs, styles } to merge
 * @returns {boolean} Whether the style was found and updated
 */
export const updateStyleInConverter = (editor, styleId, updates) => {
  if (!editor?.converter?.linkedStyles) return false;

  const style = editor.converter.linkedStyles.find((s) => s.id === styleId);
  if (!style) return false;

  if (updates.attrs) {
    style.definition.attrs = { ...style.definition.attrs, ...updates.attrs };
  }
  if (updates.styles) {
    const merged = { ...style.definition.styles };
    for (const [k, v] of Object.entries(updates.styles)) {
      if (v === null || v === undefined) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    style.definition.styles = merged;
  }

  // If name changed, update the ID to match
  if (updates.attrs?.name && updates.attrs.name !== style.definition.attrs.name) {
    // ID stays the same — only display name changes
  }

  style._dirty = true;
  return true;
};

/**
 * Add a new style to the converter's linkedStyles array
 * @param {Object} editor - The editor instance
 * @param {Object} newStyle - The full style object { id, type, definition }
 * @returns {boolean} Whether the style was added
 */
export const addStyleToConverter = (editor, newStyle) => {
  if (!editor?.converter?.linkedStyles) return false;

  // Check for ID collision
  const existing = editor.converter.linkedStyles.find((s) => s.id === newStyle.id);
  if (existing) return false;

  newStyle._dirty = true;
  editor.converter.linkedStyles.push(newStyle);
  return true;
};

/**
 * Generate a style ID from a name (PascalCase, no spaces)
 * @param {string} name - The display name
 * @param {Array} existingStyles - Existing styles to check for collisions
 * @returns {string} A unique style ID
 */
export const generateStyleId = (name, existingStyles = []) => {
  let id = name.replace(/\s+/g, '');
  const existingIds = new Set(existingStyles.map((s) => s.id));

  if (!existingIds.has(id)) return id;

  // Append a number suffix if collision
  let counter = 2;
  while (existingIds.has(`${id}${counter}`)) {
    counter++;
  }
  return `${id}${counter}`;
};

/**
 * Build an OOXML `<w:style>` element from a linkedStyles entry
 * @param {Object} style - A linkedStyles entry { id, type, definition }
 * @returns {Object} xml-js element object
 */
const buildStyleXmlElement = (style) => {
  const def = style.definition || {};
  const attrs = def.attrs || {};
  const styles = def.styles || {};

  const elements = [];

  // w:name
  elements.push({
    type: 'element',
    name: 'w:name',
    attributes: { 'w:val': attrs.name || style.id },
  });

  // w:basedOn
  if (attrs.basedOn) {
    elements.push({
      type: 'element',
      name: 'w:basedOn',
      attributes: { 'w:val': attrs.basedOn },
    });
  }

  // w:qFormat (marks it as a quick-format style)
  elements.push({ type: 'element', name: 'w:qFormat' });

  // Build w:pPr (paragraph properties)
  const pPrElements = [];
  if (attrs.outlineLevel != null) {
    pPrElements.push({
      type: 'element',
      name: 'w:outlineLvl',
      attributes: { 'w:val': String(attrs.outlineLevel) },
    });
  }
  if (styles['text-align']) {
    const alignMap = { left: 'left', center: 'center', right: 'right', justify: 'both' };
    const jcVal = alignMap[styles['text-align']] || styles['text-align'];
    pPrElements.push({
      type: 'element',
      name: 'w:jc',
      attributes: { 'w:val': jcVal },
    });
  }
  if (pPrElements.length) {
    elements.push({ type: 'element', name: 'w:pPr', elements: pPrElements });
  }

  // Build w:rPr (run properties)
  const rPrElements = [];

  // Font family
  if (styles['font-family']) {
    rPrElements.push({
      type: 'element',
      name: 'w:rFonts',
      attributes: {
        'w:ascii': styles['font-family'],
        'w:hAnsi': styles['font-family'],
      },
    });
  }

  // Bold
  const boldVal = styles.bold;
  if (boldVal && boldVal !== '0' && boldVal !== false) {
    rPrElements.push({ type: 'element', name: 'w:b' });
    rPrElements.push({ type: 'element', name: 'w:bCs' });
  }

  // Italic
  const italicVal = styles.italic;
  if (italicVal && italicVal !== '0' && italicVal !== false) {
    rPrElements.push({ type: 'element', name: 'w:i' });
    rPrElements.push({ type: 'element', name: 'w:iCs' });
  }

  // Underline
  const underlineVal = styles.underline;
  if (underlineVal && underlineVal !== 'none' && underlineVal !== '0' && underlineVal !== false) {
    const uType = typeof underlineVal === 'string' ? underlineVal : 'single';
    rPrElements.push({
      type: 'element',
      name: 'w:u',
      attributes: { 'w:val': uType },
    });
  }

  // Strike
  const strikeVal = styles.strike;
  if (strikeVal && strikeVal !== '0' && strikeVal !== false) {
    rPrElements.push({ type: 'element', name: 'w:strike' });
  }

  // Color
  if (styles.color) {
    const colorHex = styles.color.replace(/^#/, '');
    rPrElements.push({
      type: 'element',
      name: 'w:color',
      attributes: { 'w:val': colorHex },
    });
  }

  // Font size — stored as e.g. "14pt", OOXML uses half-points
  if (styles['font-size']) {
    const match = String(styles['font-size']).match(/([\d.]+)/);
    if (match) {
      const pt = parseFloat(match[1]);
      const halfPt = String(Math.round(pt * 2));
      rPrElements.push({
        type: 'element',
        name: 'w:sz',
        attributes: { 'w:val': halfPt },
      });
      rPrElements.push({
        type: 'element',
        name: 'w:szCs',
        attributes: { 'w:val': halfPt },
      });
    }
  }

  if (rPrElements.length) {
    elements.push({ type: 'element', name: 'w:rPr', elements: rPrElements });
  }

  return {
    type: 'element',
    name: 'w:style',
    attributes: {
      'w:type': style.type || 'paragraph',
      'w:styleId': style.id,
    },
    elements,
  };
};

/**
 * Sync dirty linkedStyles into the converter's styles.xml and rebuild
 * translatedLinkedStyles so the style-engine (used by DomPainter in
 * presentation mode) can resolve the updated definitions.
 * @param {Object} editor - The editor instance
 */
export const syncStylesToXml = (editor) => {
  const stylesXml = editor?.converter?.convertedXml?.['word/styles.xml'];
  const linkedStyles = editor?.converter?.linkedStyles;
  if (!stylesXml?.elements?.[0]?.elements || !linkedStyles) return;

  const xmlElements = stylesXml.elements[0].elements;

  let anyDirty = false;
  for (const style of linkedStyles) {
    if (!style._dirty) continue;
    anyDirty = true;

    const xmlEl = buildStyleXmlElement(style);
    const existingIdx = xmlElements.findIndex(
      (el) => el.name === 'w:style' && el.attributes?.['w:styleId'] === style.id,
    );

    if (existingIdx !== -1) {
      xmlElements[existingIdx] = xmlEl;
    } else {
      xmlElements.push(xmlEl);
    }
  }

  // Rebuild the translated styles so the style-engine picks up the changes
  if (anyDirty && editor.converter) {
    editor.converter.translatedLinkedStyles = translateStyleDefinitions(editor.converter.convertedXml);
  }
};
