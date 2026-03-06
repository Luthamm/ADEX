<script setup>
import { computed, ref, onMounted } from 'vue';
import { toolbarIcons } from './toolbarIcons.js';
import { generateLinkedStyleString, getQuickFormatList } from '@extensions/linked-styles/index.js';
import ellipsisHorizontalSvg from '@superdoc/common/icons/ellipsis-horizontal-solid.svg?raw';

const emit = defineEmits(['select', 'modify', 'create']);
const styleRefs = ref([]);
const props = defineProps({
  editor: {
    type: Object,
    required: true,
  },
  selectedOption: {
    type: String,
  },
  /** Pre-computed styles list passed from parent. Falls back to reading from editor. */
  styles: {
    type: Array,
    default: null,
  },
});

const styleList = computed(() => {
  return props.styles || getQuickFormatList(props.editor);
});

const select = (style) => {
  emit('select', style);
};

const modifyStyle = (event, style) => {
  event.stopPropagation();
  emit('modify', style);
};

const createStyle = () => {
  emit('create');
};

const moveToNextStyle = (index) => {
  if (index === styleRefs.value.length - 1) {
    return;
  }
  const nextItem = styleRefs.value[index + 1];
  nextItem.setAttribute('tabindex', '0');
  nextItem.focus();
};

const moveToPreviousStyle = (index) => {
  if (index === 0) {
    return;
  }
  const previousItem = styleRefs.value[index - 1];
  previousItem.setAttribute('tabindex', '0');
  previousItem.focus();
};

const handleKeyDown = (event, index, style) => {
  switch (event.key) {
    case 'ArrowDown':
      moveToNextStyle(index);
      break;
    case 'ArrowUp':
      moveToPreviousStyle(index);
      break;
    case 'Enter':
      event.preventDefault();
      select(style);
      break;
    default:
      break;
  }
};
onMounted(() => {
  // Focus on the first style item
  styleRefs.value[0].setAttribute('tabindex', '0');
  styleRefs.value[0].focus();
});
</script>

<template>
  <div class="linked-style-container" v-if="props.editor" data-editor-ui-surface>
    <div class="linked-style-buttons">
      <div
        v-for="(style, index) in styleList"
        class="style-item"
        @click="select(style)"
        @keydown="(event) => handleKeyDown(event, index, style)"
        :class="{ selected: selectedOption === style.id }"
        :aria-label="`Linked style - ${style.id}`"
        ref="styleRefs"
      >
        <div
          class="style-name"
          :style="generateLinkedStyleString(style, null, null, false)"
          data-item="btn-linkedStyles-option"
        >
          {{ style.definition.attrs.name }}
        </div>
        <div
          class="style-more-btn"
          @click="(e) => modifyStyle(e, style)"
          title="Modify style"
          v-html="ellipsisHorizontalSvg"
        ></div>
      </div>
    </div>
    <div class="new-style-btn" @click="createStyle">+ New Style</div>
  </div>
</template>

<style scoped>
.style-item {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.style-item:hover {
  background-color: #e8edf3;
}

.style-item.selected {
  background-color: #d0ddf0;
}

.style-name {
  padding: 16px 10px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.style-more-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  margin-right: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  color: #666;
}

.style-item:hover .style-more-btn {
  opacity: 1;
}

.style-more-btn:hover {
  background-color: #c8d0d8;
  color: #333;
}

.style-more-btn :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
  fill: currentColor;
}

.linked-style-container {
  display: flex;
  flex-direction: column;
  width: 220px;
  max-height: 400px;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

.linked-style-buttons {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.new-style-btn {
  padding: 10px;
  cursor: pointer;
  font-size: 13px;
  color: #1355ff;
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.new-style-btn:hover {
  background-color: #e8edf3;
}

.button-icon {
  cursor: pointer;
  padding: 5px;
  font-size: 16px;
  width: 25px;
  height: 25px;
  border-radius: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}
.button-icon:hover {
  background-color: #d8dee5;
}

.button-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}
</style>
