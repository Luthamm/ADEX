<script setup>
import { ref, computed, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';
import ButtonGroup from './ButtonGroup.vue';
import { toolbarIcons } from './toolbarIcons.js';

const { proxy } = getCurrentInstance();

const emit = defineEmits(['command']);

const props = defineProps({
  section: {
    type: Object,
    required: true,
  },
});

const isOpen = ref(false);
const panelRef = ref(null);
const triggerRef = ref(null);
const hasOpenDropdown = ref(false);

const caretIcon = computed(() => {
  return isOpen.value ? toolbarIcons.dropdownCaretUp : toolbarIcons.dropdownCaretDown;
});

const toggle = () => {
  isOpen.value = !isOpen.value;
};

const close = () => {
  isOpen.value = false;
};

const handleCommand = ({ item, argument }) => {
  proxy.$toolbar.emitCommand({ item, argument });
};

const handleClickOutside = (e) => {
  if (!isOpen.value) return;
  if (hasOpenDropdown.value) return;
  const panel = panelRef.value;
  const trigger = triggerRef.value;
  if (panel && panel.contains(e.target)) return;
  if (trigger && trigger.contains(e.target)) return;
  close();
};

const handleKeyDown = (e) => {
  if (e.key === 'Escape' && isOpen.value && !hasOpenDropdown.value) {
    e.preventDefault();
    close();
  }
};

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside, true);
  document.addEventListener('keydown', handleKeyDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside, true);
  document.removeEventListener('keydown', handleKeyDown, true);
});
</script>

<template>
  <div class="collapsed-section">
    <div
      ref="triggerRef"
      class="collapsed-section__trigger"
      :class="{ active: isOpen }"
      role="button"
      :aria-label="`${section.id} section`"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <div class="collapsed-section__icon" v-html="section.icon"></div>
      <div class="collapsed-section__caret" v-html="caretIcon"></div>
    </div>
    <div v-if="isOpen" ref="panelRef" class="collapsed-section__panel" role="group">
      <ButtonGroup
        class="collapsed-section__items"
        :toolbar-items="section.items"
        from-overflow
        @command="handleCommand"
        @dropdown-update-show="hasOpenDropdown = $event"
      />
    </div>
  </div>
</template>

<style lang="postcss" scoped>
.collapsed-section {
  position: relative;
  display: inline-flex;
  margin: 0 1px;
}

.collapsed-section__trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 4px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  color: #47484a;
  transition: all 0.2s ease-out;
  user-select: none;
  box-sizing: border-box;
  gap: 2px;

  &:hover {
    background-color: #dbdbdb;
  }

  &.active {
    background-color: #c8d0d8;
  }
}

.collapsed-section__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 16px;

  :deep(svg) {
    width: auto;
    max-height: 16px;
  }
}

.collapsed-section__caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 10px;
  height: 10px;
}

.collapsed-section__panel {
  position: absolute;
  top: calc(100% + 3px);
  right: 0;
  padding: 4px 8px;
  background-color: #fff;
  border-radius: 8px;
  z-index: 100;
  box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
  white-space: nowrap;
}

.collapsed-section__items {
  min-width: auto !important;
  flex-wrap: wrap;
  max-width: 240px;
}
</style>
