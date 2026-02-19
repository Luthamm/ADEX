<template>
  <div v-if="visible && tableMetadata" class="superdoc-table-row-resize-overlay" :style="overlayStyle" @mousedown.stop>
    <!-- Resize handles for each row boundary (bottom edge of each row) -->
    <div
      v-for="(boundary, boundaryIndex) in resizableBoundaries"
      :key="`row-handle-${boundary.index}`"
      class="row-resize-handle"
      :class="{
        'row-resize-handle--active': dragState && dragState.boundaryIndex === boundaryIndex,
      }"
      :style="getHandleStyle(boundary)"
      :data-boundary-index="boundaryIndex"
      @mousedown="onHandleMouseDown($event, boundaryIndex)"
    ></div>

    <!-- Visual guideline during drag -->
    <div v-if="dragState" class="row-resize-guideline" :style="guidelineStyle"></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { pixelsToTwips } from '@core/super-converter/helpers.js';
import { measureCache } from '@superdoc/layout-bridge';

const props = defineProps({
  editor: {
    type: Object,
    required: true,
  },
  visible: {
    type: Boolean,
    default: false,
  },
  tableElement: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['resize-start', 'resize-move', 'resize-end', 'resize-success', 'resize-error']);

const overlayRect = ref(null);
const tableMetadata = ref(null);

// ============================================================================
// Constants
// ============================================================================

/** Height of the resize handle hit area in pixels (screen space). */
const RESIZE_HANDLE_HEIGHT_PX = 9;

/** Vertical offset to center the resize handle on the boundary line. */
const RESIZE_HANDLE_OFFSET_PX = 4;

/** Extension added to overlay height during drag for smooth mouse tracking. */
const DRAG_OVERLAY_EXTENSION_PX = 1000;

/** Minimum overlay height during drag operations. */
const MIN_DRAG_OVERLAY_HEIGHT_PX = 2000;

/** Throttle interval for mouse move events (~60fps). */
const THROTTLE_INTERVAL_MS = 16;

/** Minimum delta threshold to dispatch a resize transaction. */
const MIN_RESIZE_DELTA_PX = 1;

// ============================================================================
// State
// ============================================================================

const dragState = ref(null);
const forcedCleanup = ref(false);
let rafId = null;
let isUnmounted = false;

const getZoom = () => {
  const editor = props.editor;
  if (editor && typeof editor.zoom === 'number') {
    return editor.zoom;
  }
  if (editor?.presentationEditor && typeof editor.presentationEditor.zoom === 'number') {
    return editor.presentationEditor.zoom;
  }
  return 1;
};

// ============================================================================
// Overlay tracking
// ============================================================================

function startOverlayTracking() {
  if (rafId !== null) return;
  const step = () => {
    updateOverlayRect();
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function stopOverlayTracking() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

const overlayStyle = computed(() => {
  if (!overlayRect.value || !props.tableElement) return {};

  const rect = overlayRect.value;

  let overlayHeight = rect.height;
  if (dragState.value) {
    overlayHeight = Math.max(rect.height + DRAG_OVERLAY_EXTENSION_PX, MIN_DRAG_OVERLAY_HEIGHT_PX);
  }

  return {
    position: 'absolute',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${overlayHeight}px`,
    pointerEvents: dragState.value ? 'auto' : 'none',
    zIndex: 10,
  };
});

function updateOverlayRect() {
  if (!props.tableElement) {
    overlayRect.value = null;
    return;
  }

  const tableRect = props.tableElement.getBoundingClientRect();
  if (tableRect.width === 0 || tableRect.height === 0) {
    overlayRect.value = null;
    return;
  }

  const superEditor = props.tableElement.closest('.super-editor');
  if (superEditor) {
    const containerRect = superEditor.getBoundingClientRect();
    const left = tableRect.left - containerRect.left + superEditor.scrollLeft;
    const top = tableRect.top - containerRect.top + superEditor.scrollTop;
    overlayRect.value = { left, top, width: tableRect.width, height: tableRect.height };
  } else {
    overlayRect.value = {
      left: props.tableElement.offsetLeft,
      top: props.tableElement.offsetTop,
      width: tableRect.width,
      height: tableRect.height,
    };
  }
}

// ============================================================================
// Row boundaries
// ============================================================================

const resizableBoundaries = computed(() => {
  if (!tableMetadata.value?.rows) return [];
  return tableMetadata.value.rows.filter((row) => row.r === 1);
});

function getHandleStyle(boundary) {
  const zoom = getZoom();
  // Position handle at the bottom edge of this row
  const scaledY = (boundary.y + boundary.h) * zoom;

  return {
    position: 'absolute',
    left: '0',
    top: `${scaledY}px`,
    width: '100%',
    height: `${RESIZE_HANDLE_HEIGHT_PX}px`,
    transform: `translateY(-${RESIZE_HANDLE_OFFSET_PX}px)`,
    cursor: 'row-resize',
    pointerEvents: 'auto',
  };
}

// ============================================================================
// Drag guideline
// ============================================================================

const guidelineStyle = computed(() => {
  if (!dragState.value || !tableMetadata.value) return { display: 'none' };

  const boundary = resizableBoundaries.value[dragState.value.boundaryIndex];
  if (!boundary) return { display: 'none' };

  const zoom = getZoom();
  const newY = (boundary.y + boundary.h + dragState.value.constrainedDelta) * zoom;

  return {
    position: 'absolute',
    left: '0',
    top: `${newY}px`,
    width: '100%',
    height: '2px',
    backgroundColor: '#4A90E2',
    pointerEvents: 'none',
    zIndex: 20,
  };
});

// ============================================================================
// Metadata parsing
// ============================================================================

function parseTableMetadata() {
  if (!props.tableElement) {
    tableMetadata.value = null;
    return;
  }

  try {
    const boundariesAttr = props.tableElement.getAttribute('data-table-boundaries');
    if (!boundariesAttr) {
      tableMetadata.value = null;
      return;
    }

    const parsed = JSON.parse(boundariesAttr);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rows)) {
      tableMetadata.value = null;
      return;
    }

    const validatedRows = parsed.rows
      .filter((row) => {
        return (
          typeof row === 'object' &&
          Number.isFinite(row.i) &&
          row.i >= 0 &&
          Number.isFinite(row.y) &&
          row.y >= 0 &&
          Number.isFinite(row.h) &&
          row.h > 0 &&
          Number.isFinite(row.min) &&
          row.min > 0 &&
          (row.r === 0 || row.r === 1)
        );
      })
      .map((row) => ({
        i: row.i,
        y: row.y,
        h: row.h,
        min: Math.max(1, row.min),
        r: row.r,
        index: row.i,
      }));

    if (validatedRows.length === 0) {
      tableMetadata.value = null;
      return;
    }

    tableMetadata.value = { rows: validatedRows };
  } catch (error) {
    tableMetadata.value = null;
    emit('resize-error', {
      error: error instanceof Error ? error.message : 'Failed to parse table row boundaries',
    });
  }
}

// ============================================================================
// Drag handling
// ============================================================================

function onHandleMouseDown(event, boundaryIndex) {
  event.preventDefault();
  event.stopPropagation();

  if (!tableMetadata.value?.rows) return;

  const boundary = resizableBoundaries.value[boundaryIndex];
  if (!boundary) return;

  dragState.value = {
    boundaryIndex,
    rowIndex: boundary.index,
    initialY: event.clientY,
    initialHeight: boundary.h,
    minHeight: boundary.min,
    constrainedDelta: 0,
  };

  if (!props.editor?.view?.dom) {
    emit('resize-error', { error: 'Editor view not available' });
    dragState.value = null;
    return;
  }
  const pmView = props.editor.view.dom;
  pmView.style.pointerEvents = 'none';

  try {
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mouseup', onDocumentMouseUp);

    emit('resize-start', {
      rowIndex: boundary.index,
      initialHeight: boundary.h,
    });
  } catch (error) {
    document.removeEventListener('mousemove', onDocumentMouseMove);
    document.removeEventListener('mouseup', onDocumentMouseUp);
    pmView.style.pointerEvents = 'auto';
    dragState.value = null;
    emit('resize-error', { error: error instanceof Error ? error.message : String(error) });
  }
}

function throttle(func, limit) {
  let inThrottle;
  let timeoutId = null;

  const throttled = function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      timeoutId = setTimeout(() => {
        inThrottle = false;
        timeoutId = null;
      }, limit);
    }
  };

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      inThrottle = false;
    }
  };

  return { throttled, cancel };
}

const mouseMoveThrottle = throttle((event) => {
  if (isUnmounted || !dragState.value) return;

  const zoom = getZoom();
  const screenDelta = event.clientY - dragState.value.initialY;
  const delta = screenDelta / zoom;

  // Constrain: can't make row smaller than minHeight
  const minDelta = -(dragState.value.initialHeight - dragState.value.minHeight);
  // No max constraint — rows can grow freely
  const constrainedDelta = Math.max(minDelta, delta);

  dragState.value.constrainedDelta = constrainedDelta;

  emit('resize-move', {
    rowIndex: dragState.value.rowIndex,
    delta: constrainedDelta,
  });
}, THROTTLE_INTERVAL_MS);

const onDocumentMouseMove = mouseMoveThrottle.throttled;

function onDocumentMouseUp(event) {
  if (!dragState.value) return;

  const finalDelta = dragState.value.constrainedDelta;
  const rowIndex = dragState.value.rowIndex;
  const newHeight = dragState.value.initialHeight + finalDelta;

  // Clean up
  document.removeEventListener('mousemove', onDocumentMouseMove);
  document.removeEventListener('mouseup', onDocumentMouseUp);

  if (props.editor?.view?.dom) {
    props.editor.view.dom.style.pointerEvents = 'auto';
  }

  if (!forcedCleanup.value && Math.abs(finalDelta) > MIN_RESIZE_DELTA_PX) {
    dispatchResizeTransaction(rowIndex, newHeight);

    emit('resize-end', {
      rowIndex,
      newHeight,
      delta: finalDelta,
    });
  }

  dragState.value = null;
}

// ============================================================================
// PM Transaction
// ============================================================================

function dispatchResizeTransaction(rowIndex, newHeightPx) {
  if (!props.editor?.view || !props.tableElement) return;

  try {
    const { state, dispatch } = props.editor.view;
    const tr = state.tr;

    const tablePos = findTablePosition(state, props.tableElement);
    if (tablePos === null) {
      emit('resize-error', { rowIndex, error: 'Table position not found' });
      return;
    }

    const tableNode = state.doc.nodeAt(tablePos);
    if (!tableNode || tableNode.type.name !== 'table') {
      emit('resize-error', { rowIndex, error: 'Invalid table node at position' });
      return;
    }

    // Find the target row within the table
    let rowNodePos = null;
    let rowNode = null;
    let currentRowIndex = 0;

    tableNode.forEach((child, offset) => {
      if (child.type.name === 'tableRow' && currentRowIndex === rowIndex) {
        rowNodePos = tablePos + 1 + offset;
        rowNode = child;
      }
      if (child.type.name === 'tableRow') {
        currentRowIndex++;
      }
    });

    if (rowNodePos === null || !rowNode) {
      emit('resize-error', { rowIndex, error: 'Row not found at index' });
      return;
    }

    const roundedHeight = Math.round(newHeightPx);
    const twipsValue = pixelsToTwips(roundedHeight);

    // Build updated tableRowProperties with new rowHeight
    const existingProps = rowNode.attrs.tableRowProperties || {};
    const updatedProps = {
      ...existingProps,
      rowHeight: { value: twipsValue, rule: 'atLeast' },
    };

    const newAttrs = {
      ...rowNode.attrs,
      rowHeight: roundedHeight,
      tableRowProperties: updatedProps,
    };

    tr.setNodeMarkup(rowNodePos, null, newAttrs);

    // Mark table as user-edited
    const tableAttrs = { ...tableNode.attrs, userEdited: true };
    tr.setNodeMarkup(tablePos, null, tableAttrs);

    dispatch(tr);

    // Invalidate measure cache
    const blockId = props.tableElement?.getAttribute('data-sd-block-id');
    if (blockId && blockId.trim()) {
      measureCache.invalidate([blockId]);
    }

    emit('resize-success', { rowIndex, newHeight: roundedHeight });
  } catch (error) {
    emit('resize-error', {
      rowIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function findTablePosition(state, tableElement) {
  const pmElement = tableElement.querySelector('[data-pm-start]');
  if (!pmElement) return null;

  const pmStartAttr = pmElement.getAttribute('data-pm-start');
  if (!pmStartAttr) return null;

  const pmStart = parseInt(pmStartAttr, 10);
  if (!Number.isFinite(pmStart)) return null;

  let tablePos = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      const tableEnd = pos + node.nodeSize;
      if (pmStart >= pos && pmStart < tableEnd) {
        tablePos = pos;
        return false;
      }
    }
  });

  return tablePos;
}

// ============================================================================
// Watchers and lifecycle
// ============================================================================

watch(
  () => props.tableElement,
  () => {
    parseTableMetadata();
    updateOverlayRect();
    if (props.visible && props.tableElement) {
      startOverlayTracking();
    } else if (!props.tableElement) {
      stopOverlayTracking();
    }
  },
  { immediate: true },
);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      parseTableMetadata();
      updateOverlayRect();
      startOverlayTracking();
    } else {
      stopOverlayTracking();
      if (dragState.value) {
        forcedCleanup.value = true;
        onDocumentMouseUp(new MouseEvent('mouseup'));
        forcedCleanup.value = false;
      }
    }
  },
);

onMounted(() => {
  window.addEventListener('scroll', updateOverlayRect, true);
  window.addEventListener('resize', updateOverlayRect);
  updateOverlayRect();
});

onBeforeUnmount(() => {
  isUnmounted = true;
  mouseMoveThrottle.cancel();
  stopOverlayTracking();

  if (dragState.value) {
    document.removeEventListener('mousemove', onDocumentMouseMove);
    document.removeEventListener('mouseup', onDocumentMouseUp);

    if (props.editor?.view?.dom) {
      props.editor.view.dom.style.pointerEvents = 'auto';
    }
  }

  window.removeEventListener('scroll', updateOverlayRect, true);
  window.removeEventListener('resize', updateOverlayRect);
});
</script>

<style scoped>
.superdoc-table-row-resize-overlay {
  position: absolute;
  pointer-events: none;
  user-select: none;
}

.row-resize-handle {
  position: absolute;
  cursor: row-resize;
  user-select: none;
  z-index: 15;
}

.row-resize-handle::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  height: 2px;
  width: 100%;
  background-color: rgba(74, 144, 226, 0.3);
  transform: translateY(-1px);
  transition:
    background-color 0.2s ease,
    height 0.2s ease;
}

.row-resize-handle:hover::before {
  background-color: #4a90e2;
  height: 3px;
  transform: translateY(-1.5px);
}

.row-resize-handle--active::before {
  background-color: #4a90e2;
  height: 2px;
  transform: translateY(-1px);
}

.row-resize-guideline {
  position: absolute;
  background-color: #4a90e2;
  pointer-events: none;
  box-shadow: 0 0 4px rgba(74, 144, 226, 0.5);
}
</style>
