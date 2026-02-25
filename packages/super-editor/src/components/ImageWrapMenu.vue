<template>
  <div v-if="visible && imageElement" class="superdoc-image-wrap-menu" :style="menuStyle" @mousedown.prevent.stop>
    <button
      v-for="option in wrapOptions"
      :key="option.label"
      class="wrap-option"
      :class="{ 'wrap-option--active': isActive(option) }"
      :title="option.label"
      @click="applyWrap(option)"
      v-html="option.icon"
    ></button>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  editor: {
    type: Object,
    required: true,
  },
  visible: {
    type: Boolean,
    default: false,
  },
  imageElement: {
    type: Object,
    default: null,
  },
  imagePos: {
    type: Number,
    default: null,
  },
});

const wrapIcons = {
  inline: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
    <rect x="1" y="3" width="5" height="1.5"/>
    <rect x="7.5" y="1" width="5" height="6" rx="0.5" opacity="0.45"/>
    <rect x="14" y="3" width="5" height="1.5"/>
    <rect x="1" y="9" width="18" height="1.5"/>
    <rect x="1" y="14" width="18" height="1.5"/>
  </svg>`,
  squareLeft: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
    <rect x="1" y="1" width="7" height="7" rx="0.5" opacity="0.45"/>
    <rect x="10" y="2" width="9" height="1.5"/>
    <rect x="10" y="6" width="9" height="1.5"/>
    <rect x="1" y="11" width="18" height="1.5"/>
    <rect x="1" y="15" width="14" height="1.5"/>
  </svg>`,
  squareRight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
    <rect x="12" y="1" width="7" height="7" rx="0.5" opacity="0.45"/>
    <rect x="1" y="2" width="9" height="1.5"/>
    <rect x="1" y="6" width="9" height="1.5"/>
    <rect x="1" y="11" width="18" height="1.5"/>
    <rect x="1" y="15" width="14" height="1.5"/>
  </svg>`,
  behindText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
    <rect x="5" y="3" width="10" height="10" rx="0.5" opacity="0.2"/>
    <rect x="1" y="3" width="18" height="1.5"/>
    <rect x="1" y="8" width="18" height="1.5"/>
    <rect x="1" y="13" width="18" height="1.5"/>
    <rect x="1" y="17" width="14" height="1.5"/>
  </svg>`,
  inFrontOfText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
    <rect x="1" y="3" width="18" height="1.5" opacity="0.3"/>
    <rect x="1" y="8" width="18" height="1.5" opacity="0.3"/>
    <rect x="5" y="3" width="10" height="10" rx="0.5" opacity="0.7"/>
    <rect x="1" y="13" width="18" height="1.5"/>
    <rect x="1" y="17" width="14" height="1.5"/>
  </svg>`,
};

const wrapOptions = [
  { label: 'Inline', type: 'Inline', attrs: {}, icon: wrapIcons.inline },
  { label: 'Square left', type: 'Square', attrs: { wrapText: 'right' }, icon: wrapIcons.squareLeft },
  { label: 'Square right', type: 'Square', attrs: { wrapText: 'left' }, icon: wrapIcons.squareRight },
  { label: 'Behind text', type: 'None', attrs: { behindDoc: true }, icon: wrapIcons.behindText },
  { label: 'In front of text', type: 'None', attrs: { behindDoc: false }, icon: wrapIcons.inFrontOfText },
];

const currentWrap = computed(() => {
  if (props.imagePos == null || !props.editor?.state) return null;
  const node = props.editor.state.doc.nodeAt(props.imagePos);
  if (!node || node.type.name !== 'image') return null;
  return node.attrs.wrap ?? { type: 'Inline' };
});

function isActive(option) {
  const wrap = currentWrap.value;
  if (!wrap) return false;
  if (wrap.type !== option.type) return false;
  if (option.type === 'Square') {
    return (wrap.attrs?.wrapText || 'right') === option.attrs.wrapText;
  }
  if (option.type === 'None') {
    return Boolean(wrap.attrs?.behindDoc) === option.attrs.behindDoc;
  }
  return true;
}

function applyWrap(option) {
  if (!props.editor?.commands?.setWrapping) return;
  props.editor.commands.setWrapping({ type: option.type, attrs: option.attrs });
}

const menuStyle = computed(() => {
  if (!props.imageElement || !props.imageElement.isConnected) return { display: 'none' };

  const imageRect = props.imageElement.getBoundingClientRect();
  const wrapper = props.imageElement.closest('.super-editor');
  if (!wrapper) return { display: 'none' };

  const wrapperRect = wrapper.getBoundingClientRect();
  const scrollLeft = wrapper.scrollLeft || 0;
  const scrollTop = wrapper.scrollTop || 0;

  const imageCenterX = imageRect.left - wrapperRect.left + scrollLeft + imageRect.width / 2;
  const top = imageRect.bottom - wrapperRect.top + scrollTop + 4;

  return {
    position: 'absolute',
    left: `${imageCenterX}px`,
    top: `${top}px`,
    transform: 'translateX(-50%)',
    zIndex: 20,
  };
});
</script>

<style scoped>
.superdoc-image-wrap-menu {
  display: flex;
  gap: 2px;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
}

.wrap-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: #555;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.wrap-option :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.wrap-option:hover {
  background-color: #f0f0f0;
  color: #333;
}

.wrap-option--active {
  background-color: #e3f2fd;
  color: #1976d2;
}
</style>
