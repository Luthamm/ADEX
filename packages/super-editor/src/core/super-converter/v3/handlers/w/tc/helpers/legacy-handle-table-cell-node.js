import { eighthPointsToPixels, twipsToPixels, resolveShadingFillColor } from '@converter/helpers';
import { translator as tcPrTranslator } from '../../tcPr';

/**
 * @param {Object} options
 * @returns {{type: string, content: (*|*[]), attrs: {}}}
 */
export function handleTableCellNode({
  params,
  node,
  table,
  row,
  tableProperties,
  rowBorders,
  baseTableBorders,
  tableLook,
  rowCnfStyle,
  columnIndex,
  columnWidth = null,
  allColumnWidths = [],
  rowIndex = 0,
  totalRows = 1,
  totalColumns,
  preferTableGridWidths = false,
  _referencedStyles,
}) {
  const { nodeListHandler } = params;
  const attributes = {};
  const referencedStyles = _referencedStyles ?? { fontSize: null, fonts: {}, cellMargins: {} };

  // Table Cell Properties
  const tcPr = node.elements.find((el) => el.name === 'w:tcPr');
  const tableCellProperties = tcPr ? (tcPrTranslator.encode({ ...params, nodes: [tcPr] }) ?? {}) : {};
  attributes['tableCellProperties'] = tableCellProperties;

  // Determine cell position for border application
  // Fall back to allColumnWidths.length if totalColumns not provided
  // Fall back to counting table rows if totalRows not provided
  const effectiveTotalColumns = totalColumns ?? (allColumnWidths.length || 1);
  const effectiveTotalRows = totalRows ?? (table?.elements?.filter((el) => el.name === 'w:tr').length || 1);
  const colspan = parseInt(tableCellProperties.gridSpan || 1, 10);
  const isFirstRow = rowIndex === 0;
  const isLastRow = rowIndex === effectiveTotalRows - 1;
  const isFirstColumn = columnIndex === 0;
  const isLastColumn = columnIndex + colspan >= effectiveTotalColumns;

  attributes['borders'] = processCellBorders({
    baseTableBorders,
    rowBorders,
    tableLook,
    rowCnfStyle,
    isFirstRow,
    isLastRow,
    isFirstColumn,
    isLastColumn,
    tableCellProperties,
    referencedStyles,
  });
  // Colspan
  if (colspan > 1) attributes['colspan'] = colspan;

  // Width
  let width = null;
  const widthType = tableCellProperties.cellWidth?.type;
  if (!preferTableGridWidths) {
    // For percentage widths, don't convert to px here; allow table/grid widths to drive layout.
    if (widthType !== 'pct') {
      width = tableCellProperties.cellWidth?.value ? twipsToPixels(tableCellProperties.cellWidth?.value) : null;
    }
  }
  if (widthType) attributes['widthType'] = widthType;

  if (!width && columnWidth) width = columnWidth;
  if (width) {
    attributes['colwidth'] = [width];
    attributes['widthUnit'] = 'px';

    const defaultColWidths = allColumnWidths;
    const hasDefaultColWidths = allColumnWidths && allColumnWidths.length > 0;

    if (colspan > 1 && hasDefaultColWidths) {
      let colwidth = [];

      for (let i = 0; i < colspan; i++) {
        let colwidthValue = defaultColWidths[columnIndex + i];
        let defaultColwidth = 100;

        if (typeof colwidthValue !== 'undefined') {
          colwidth.push(colwidthValue);
        } else {
          colwidth.push(defaultColwidth);
        }
      }

      if (colwidth.length) {
        attributes['colwidth'] = [...colwidth];
      }
    }
  }

  // Background - resolve shading with conditional formatting support
  // Priority: inline cell shading > conditional style shading > table-level shading
  const themeColors = params.themeColors || null;

  // Helpers to check if conditional style flags are enabled
  // Flags come as strings "0"/"1" from XML, need to convert to boolean
  const cellCnfStyle = tableCellProperties?.cnfStyle;
  const getFlag = (source, flag) =>
    source && Object.prototype.hasOwnProperty.call(source, flag) ? source[flag] : undefined;
  const isFlagTrue = (val) => val === true || val === 1 || val === '1';

  // Check if horizontal banding is enabled at table level
  // tableLook uses noHBand (inverted: "1" means banding DISABLED)
  const isHBandEnabled = !isFlagTrue(getFlag(tableLook, 'noHBand'));

  // Row-level conditions (firstRow, lastRow) - check rowCnfStyle and tableLook
  // Cell cnfStyle should NOT override row-level conditions
  const isRowStyleEnabled = (flag) => {
    const val = getFlag(rowCnfStyle, flag) ?? getFlag(tableLook, flag);
    if (val === undefined) return true; // default enabled if not specified
    return isFlagTrue(val);
  };

  // Column-level conditions (firstColumn, lastColumn) - check tableLook first (style toggle),
  // then cellCnfStyle as a secondary check. tableLook controls whether the style is ENABLED
  // at table level, while cellCnfStyle indicates which cells the style applies to.
  const isColStyleEnabled = (flag) => {
    // First check tableLook - this is the primary toggle for whether the style is enabled
    const tableLookVal = getFlag(tableLook, flag);
    if (tableLookVal !== undefined && !isFlagTrue(tableLookVal)) {
      return false; // Explicitly disabled at table level
    }
    // If table level doesn't disable it, check cell cnfStyle for position confirmation
    const cnfVal = getFlag(cellCnfStyle, flag);
    if (cnfVal !== undefined) {
      return isFlagTrue(cnfVal);
    }
    // Default: enabled if table level is enabled or unspecified
    return true;
  };

  // Get shading from conditional styles (firstRow, lastRow, firstCol, lastCol, bands)
  // Important: Only return a shading if it resolves to an actual color.
  // Shading with fill="auto" means "no fill" and should not prevent fallback to other styles.
  const hasValidFill = (shading) => {
    if (!shading) return false;
    // Check if the shading has a fill that will resolve to an actual color
    const color = resolveShadingFillColor(shading, themeColors);
    return color !== null && color !== undefined;
  };

  const getConditionalShading = () => {
    // Check in priority order - more specific conditions first
    // Row-level conditions use isRowStyleEnabled (ignores cell cnfStyle)
    if (isFirstRow && isRowStyleEnabled('firstRow')) {
      const shading = referencedStyles?.firstRow?.tableCellProperties?.shading;
      if (hasValidFill(shading)) return shading;
    }
    if (isLastRow && isRowStyleEnabled('lastRow')) {
      const shading = referencedStyles?.lastRow?.tableCellProperties?.shading;
      if (hasValidFill(shading)) return shading;
    }
    // Column-level conditions use isColStyleEnabled
    if (isFirstColumn && isColStyleEnabled('firstColumn')) {
      const shading = referencedStyles?.firstCol?.tableCellProperties?.shading;
      if (hasValidFill(shading)) return shading;
    }
    if (isLastColumn && isColStyleEnabled('lastColumn')) {
      const shading = referencedStyles?.lastCol?.tableCellProperties?.shading;
      if (hasValidFill(shading)) return shading;
    }
    // Banded rows - only apply if banding is enabled at table level (noHBand != "1")
    // AND the row's cnfStyle indicates it's in a banded position
    if (isHBandEnabled && isFlagTrue(getFlag(rowCnfStyle, 'oddHBand'))) {
      const shading = referencedStyles?.band1Horz?.tableCellProperties?.shading;
      if (hasValidFill(shading)) return shading;
    }
    if (isHBandEnabled && isFlagTrue(getFlag(rowCnfStyle, 'evenHBand'))) {
      const shading = referencedStyles?.band2Horz?.tableCellProperties?.shading;
      if (hasValidFill(shading)) return shading;
    }
    return null;
  };

  const backgroundColor =
    resolveShadingFillColor(tableCellProperties.shading, themeColors) ??
    resolveShadingFillColor(getConditionalShading(), themeColors) ??
    resolveShadingFillColor(tableProperties?.shading, themeColors);
  const background = { color: backgroundColor };

  // TODO: Do we need other background attrs?
  if (background.color) attributes['background'] = background;

  // Vertical Align
  const verticalAlign = tableCellProperties.vAlign;
  if (verticalAlign) attributes['verticalAlign'] = verticalAlign;

  // Cell Margins
  attributes.cellMargins = getTableCellMargins(tableCellProperties.cellMargins, referencedStyles);

  // Font size and family
  const { fontSize, fonts = {} } = referencedStyles;
  const fontFamily = fonts['ascii'];
  if (fontSize) attributes['fontSize'] = fontSize;
  if (fontFamily) attributes['fontFamily'] = fontFamily;

  // Rowspan - tables can have vertically merged cells
  if (tableCellProperties.vMerge === 'restart') {
    const rows = table.elements.filter((el) => el.name === 'w:tr');
    const currentRowIndex = rows.findIndex((r) => r === row);
    const remainingRows = rows.slice(currentRowIndex + 1);

    const cellsInRow = row.elements.filter((el) => el.name === 'w:tc');
    let cellIndex = cellsInRow.findIndex((el) => el === node);
    let rowspan = 1;

    // Iterate through all remaining rows after the current cell, and find all cells that need to be merged
    for (let remainingRow of remainingRows) {
      const firstCell = remainingRow.elements.findIndex((el) => el.name === 'w:tc');
      const cellAtIndex = remainingRow.elements[firstCell + cellIndex];

      if (!cellAtIndex) break;

      const vMerge = getTableCellVMerge(cellAtIndex);

      if (!vMerge || vMerge === 'restart') {
        // We have reached the end of the vertically merged cells
        break;
      }

      // This cell is part of a merged cell, merge it (remove it from its row)
      rowspan++;
      remainingRow.elements.splice(firstCell + cellIndex, 1);
    }
    attributes['rowspan'] = rowspan;
  }

  return {
    type: 'tableCell',
    content: normalizeTableCellContent(
      nodeListHandler.handler({
        ...params,
        nodes: node.elements,
        path: [...(params.path || []), node],
      }),
      params.editor,
    ),
    attrs: attributes,
  };
}

function normalizeTableCellContent(content, editor) {
  if (!Array.isArray(content) || content.length === 0) return content;

  const normalized = [];
  const pendingForNextBlock = [];
  const schema = editor?.schema;

  const cloneBlock = (node) => {
    if (!node) return node;
    const cloned = { ...node };
    if (Array.isArray(node.content)) {
      cloned.content = [...node.content];
    } else if (!('content' in node)) {
      // Leave undefined; will be set only if needed
    }
    return cloned;
  };

  const ensureArray = (node) => {
    if (!Array.isArray(node.content)) {
      node.content = [];
    }
    return node.content;
  };

  const isInlineNode = (node) => {
    if (!node || typeof node.type !== 'string') return false;
    if (node.type === 'text') return true;
    if (node.type === 'bookmarkStart' || node.type === 'bookmarkEnd') return true;

    const nodeType = schema?.nodes?.[node.type];
    if (nodeType) {
      if (typeof nodeType.isInline === 'boolean') return nodeType.isInline;
      if (nodeType.spec?.group && typeof nodeType.spec.group === 'string') {
        return nodeType.spec.group.split(' ').includes('inline');
      }
    }

    return false;
  };

  for (const node of content) {
    if (!node || typeof node.type !== 'string') {
      normalized.push(node);
      continue;
    }

    if (!isInlineNode(node)) {
      const blockNode = cloneBlock(node);
      if (pendingForNextBlock.length) {
        const blockContent = ensureArray(blockNode);
        const leadingInline = pendingForNextBlock.splice(0);
        blockNode.content = [...leadingInline, ...blockContent];
      } else if (Array.isArray(blockNode.content)) {
        blockNode.content = [...blockNode.content];
      }

      normalized.push(blockNode);
      continue;
    }

    const targetIsNextBlock = node.type === 'bookmarkStart' || normalized.length === 0;
    if (targetIsNextBlock) {
      pendingForNextBlock.push(node);
    } else {
      const lastIndex = normalized.length - 1;
      const lastNode = normalized[lastIndex];
      if (!lastNode || typeof lastNode.type !== 'string' || isInlineNode(lastNode)) {
        pendingForNextBlock.push(node);
        continue;
      }

      const blockContent = ensureArray(lastNode);
      if (pendingForNextBlock.length) {
        blockContent.push(...pendingForNextBlock.splice(0));
      }
      blockContent.push(node);
    }
  }

  if (pendingForNextBlock.length) {
    if (normalized.length) {
      const lastIndex = normalized.length - 1;
      const lastNode = normalized[lastIndex];
      if (lastNode && typeof lastNode.type === 'string' && !isInlineNode(lastNode)) {
        const blockContent = ensureArray(lastNode);
        blockContent.push(...pendingForNextBlock);
        pendingForNextBlock.length = 0;
      }
    }

    if (pendingForNextBlock.length) {
      normalized.push({
        type: 'paragraph',
        attrs: {},
        content: [...pendingForNextBlock],
      });
      pendingForNextBlock.length = 0;
    }
  }

  return normalized;
}
const processInlineCellBorders = (borders, rowBorders) => {
  if (!borders) return null;

  return ['bottom', 'top', 'left', 'right'].reduce((acc, direction) => {
    const borderAttrs = borders[direction];
    const rowBorderAttrs = rowBorders[direction];

    if (borderAttrs && borderAttrs['val'] !== 'none') {
      const color = borderAttrs['color'];
      let size = borderAttrs['size'];
      if (size) size = eighthPointsToPixels(size);
      acc[direction] = { color, size, val: borderAttrs['val'] };
      return acc;
    }
    if (borderAttrs && borderAttrs['val'] === 'none') {
      // When inline border explicitly says 'none', always create an entry to disable the border
      // Copy base border attrs if available, but always set val='none'
      const border = Object.assign({}, rowBorderAttrs || {});
      border['val'] = 'none';
      acc[direction] = border;
      return acc;
    }
    return acc;
  }, {});
};

const processCellBorders = ({
  baseTableBorders,
  rowBorders,
  tableLook,
  rowCnfStyle,
  isFirstRow,
  isLastRow,
  isFirstColumn,
  isLastColumn,
  tableCellProperties,
  referencedStyles,
}) => {
  let cellBorders = {};
  if (baseTableBorders) {
    if (isFirstRow && baseTableBorders.top) {
      cellBorders.top = baseTableBorders.top;
    }
    if (isLastRow && baseTableBorders.bottom) {
      cellBorders.bottom = baseTableBorders.bottom;
    }
    if (isFirstColumn && baseTableBorders.left) {
      cellBorders.left = baseTableBorders.left;
    }
    if (isLastColumn && baseTableBorders.right) {
      cellBorders.right = baseTableBorders.right;
    }
  }

  if (rowBorders) {
    if (rowBorders.top?.val) {
      cellBorders.top = rowBorders.top;
    }

    if (rowBorders.bottom?.val) {
      cellBorders.bottom = rowBorders.bottom;
    }

    if (rowBorders.left?.val) {
      const applyLeftToAll = rowBorders.left.val === 'none';
      if (applyLeftToAll || isFirstColumn) {
        cellBorders.left = rowBorders.left;
      }
    }

    if (rowBorders.right?.val) {
      const applyRightToAll = rowBorders.right.val === 'none';
      if (applyRightToAll || isLastColumn) {
        cellBorders.right = rowBorders.right;
      }
    }

    // INNER BORDERS: Position-based (including for 'none' values)
    // insideH creates horizontal lines between rows (applied as bottom border to non-last rows)
    if (!isLastRow && rowBorders.insideH) {
      cellBorders.bottom = rowBorders.insideH;
    }
    // insideV creates vertical lines between columns (applied as right border to non-last columns)
    if (!isLastColumn && rowBorders.insideV) {
      cellBorders.right = rowBorders.insideV;
    }
  }

  const getStyleTableCellBorders = (styleVariant) => styleVariant?.tableCellProperties?.borders ?? null;

  // Helpers to check if conditional style flags are enabled
  // Flags come as strings "0"/"1" from XML, need to convert to boolean
  const cellCnfStyle = tableCellProperties?.cnfStyle;
  const getFlag = (source, flag) =>
    source && Object.prototype.hasOwnProperty.call(source, flag) ? source[flag] : undefined;
  const isFlagTrue = (val) => val === true || val === 1 || val === '1';

  // Row-level conditions - check rowCnfStyle and tableLook only
  const isRowStyleEnabled = (flag) => {
    const val = getFlag(rowCnfStyle, flag) ?? getFlag(tableLook, flag);
    if (val === undefined) return true;
    return isFlagTrue(val);
  };

  // Column-level conditions - check tableLook first (style toggle), then cellCnfStyle
  const isColStyleEnabled = (flag) => {
    // First check tableLook - this is the primary toggle for whether the style is enabled
    const tableLookVal = getFlag(tableLook, flag);
    if (tableLookVal !== undefined && !isFlagTrue(tableLookVal)) {
      return false; // Explicitly disabled at table level
    }
    // If table level doesn't disable it, check cell cnfStyle for position confirmation
    const cnfVal = getFlag(cellCnfStyle, flag);
    if (cnfVal !== undefined) {
      return isFlagTrue(cnfVal);
    }
    // Default: enabled if table level is enabled or unspecified
    return true;
  };

  // Apply table style conditional formatting borders.
  // Only apply the relevant edge per conditional style:
  // - firstRow/lastRow => top/bottom
  // - firstCol/lastCol => left/right
  const applyStyleBorders = (styleVariant, allowedDirections) => {
    const styleBorders = getStyleTableCellBorders(styleVariant);
    if (!styleBorders) return;
    const filteredBorders = allowedDirections.reduce((acc, direction) => {
      if (styleBorders[direction]) acc[direction] = styleBorders[direction];
      return acc;
    }, {});
    const styleOverrides = processInlineCellBorders(filteredBorders, cellBorders);
    if (styleOverrides) cellBorders = Object.assign(cellBorders, styleOverrides);
  };

  // Row-level conditions use isRowStyleEnabled, column-level use isColStyleEnabled
  if (isFirstRow && isRowStyleEnabled('firstRow')) applyStyleBorders(referencedStyles?.firstRow, ['top', 'bottom']);
  if (isLastRow && isRowStyleEnabled('lastRow')) applyStyleBorders(referencedStyles?.lastRow, ['top', 'bottom']);
  if (isFirstColumn && isColStyleEnabled('firstColumn'))
    applyStyleBorders(referencedStyles?.firstCol, ['left', 'right']);
  if (isLastColumn && isColStyleEnabled('lastColumn')) applyStyleBorders(referencedStyles?.lastCol, ['left', 'right']);

  // Process inline cell borders (cell-level overrides)
  const inlineBorders = processInlineCellBorders(tableCellProperties.borders, cellBorders);
  if (inlineBorders) cellBorders = Object.assign(cellBorders, inlineBorders);
  return cellBorders;
};

const getTableCellVMerge = (node) => {
  const tcPr = node.elements.find((el) => el.name === 'w:tcPr');
  const vMerge = tcPr?.elements?.find((el) => el.name === 'w:vMerge');
  if (!vMerge) return null;
  return vMerge.attributes?.['w:val'] || 'continue';
};

/**
 * Process the margins for a table cell
 * @param {Object} inlineMargins
 * @param {Object} referencedStyles
 * @returns
 */
const getTableCellMargins = (inlineMargins, referencedStyles) => {
  const { cellMargins = {} } = referencedStyles;
  return ['left', 'right', 'top', 'bottom'].reduce((acc, direction) => {
    const key = `margin${direction.charAt(0).toUpperCase() + direction.slice(1)}`;
    const inlineValue = inlineMargins ? inlineMargins?.[key]?.value : null;
    const styleValue = cellMargins ? cellMargins[key] : null;
    if (inlineValue != null) {
      acc[direction] = twipsToPixels(inlineValue);
    } else if (styleValue == null) {
      acc[direction] = undefined;
    } else if (typeof styleValue === 'object') {
      acc[direction] = twipsToPixels(styleValue.value);
    } else {
      acc[direction] = twipsToPixels(styleValue);
    }
    return acc;
  }, {});
};
