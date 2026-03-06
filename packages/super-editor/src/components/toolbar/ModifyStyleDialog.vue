<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits(['save', 'cancel']);

const props = defineProps({
  /** The style being edited, or null for new style creation */
  style: {
    type: Object,
    default: null,
  },
  /** All available styles (for "Based on" dropdown) */
  allStyles: {
    type: Array,
    default: () => [],
  },
  /** Whether creating a new style (vs editing) */
  isNew: {
    type: Boolean,
    default: false,
  },
});

// Form state
const styleName = ref('');
const basedOn = ref('');
const fontFamily = ref('');
const fontSize = ref('');
const isBold = ref(false);
const isItalic = ref(false);
const isUnderline = ref(false);
const fontColor = ref('#000000');
const textAlign = ref('left');
const headingLevel = ref('');
const showBasedOnDropdown = ref(false);
const showHeadingDropdown = ref(false);

const headingOptions = [
  { value: '', label: '(none)' },
  { value: '0', label: 'Heading 1' },
  { value: '1', label: 'Heading 2' },
  { value: '2', label: 'Heading 3' },
  { value: '3', label: 'Heading 4' },
];

// Initialize form from style prop
const initForm = () => {
  if (props.style && !props.isNew) {
    const def = props.style.definition || {};
    const attrs = def.attrs || {};
    const styles = def.styles || {};

    styleName.value = attrs.name || props.style.id || '';
    basedOn.value = attrs.basedOn || '';
    headingLevel.value = attrs.outlineLevel != null ? String(attrs.outlineLevel) : '';
    fontFamily.value = styles['font-family'] || '';
    fontSize.value = styles['font-size'] || '';
    fontColor.value = styles.color || '#000000';
    textAlign.value = styles['text-align'] || 'left';

    // Bold can be stored as true, 'true', or an object
    const boldVal = styles.bold;
    isBold.value = boldVal && boldVal !== '0' && boldVal !== false;

    const italicVal = styles.italic;
    isItalic.value = italicVal && italicVal !== '0' && italicVal !== false;

    const underlineVal = styles.underline;
    isUnderline.value = !!underlineVal && underlineVal !== 'none' && underlineVal !== '0';
  } else {
    styleName.value = '';
    basedOn.value = '';
    headingLevel.value = '';
    fontFamily.value = '';
    fontSize.value = '';
    isBold.value = false;
    isItalic.value = false;
    isUnderline.value = false;
    fontColor.value = '#000000';
    textAlign.value = 'left';
  }
};

onMounted(() => {
  initForm();
  document.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown);
});

const handleKeyDown = (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('cancel');
  }
};

const dialogTitle = computed(() => (props.isNew ? 'New Style' : 'Modify Style'));

const basedOnOptions = computed(() => {
  return props.allStyles.filter((s) => !props.style || s.id !== props.style.id);
});

const basedOnLabel = computed(() => {
  if (!basedOn.value) return '(no style)';
  const found = props.allStyles.find((s) => s.id === basedOn.value);
  return found?.definition?.attrs?.name || basedOn.value;
});

const previewStyle = computed(() => {
  const parts = [];
  if (fontFamily.value) parts.push(`font-family: ${fontFamily.value}`);
  if (fontSize.value) parts.push(`font-size: ${fontSize.value}`);
  if (isBold.value) parts.push('font-weight: bold');
  if (isItalic.value) parts.push('font-style: italic');
  if (isUnderline.value) parts.push('text-decoration: underline');
  if (fontColor.value && fontColor.value !== '#000000') parts.push(`color: ${fontColor.value}`);
  if (textAlign.value) parts.push(`text-align: ${textAlign.value}`);
  return parts.join('; ');
});

const canSave = computed(() => {
  if (props.isNew) return styleName.value.trim().length > 0;
  return true;
});

const handleSave = () => {
  if (!canSave.value) return;

  const styles = {};
  styles['font-family'] = fontFamily.value || null;
  styles['font-size'] = fontSize.value || null;
  styles.bold = isBold.value ? true : false;
  styles.italic = isItalic.value ? true : false;
  styles.underline = isUnderline.value ? 'single' : false;
  styles.color = fontColor.value || null;
  styles['text-align'] = textAlign.value || null;

  emit('save', {
    styleId: props.style?.id || null,
    isNew: props.isNew,
    name: styleName.value.trim(),
    basedOn: basedOn.value || null,
    outlineLevel: headingLevel.value !== '' ? parseInt(headingLevel.value) : null,
    styles,
  });
};

const headingLabel = computed(() => {
  const opt = headingOptions.find((o) => o.value === headingLevel.value);
  return opt ? opt.label : '(none)';
});

const selectHeading = (value) => {
  headingLevel.value = value;
  showHeadingDropdown.value = false;
};

const selectBasedOn = (styleId) => {
  basedOn.value = styleId;
  showBasedOnDropdown.value = false;
};
</script>

<template>
  <div class="modify-style-dialog" data-editor-ui-surface @mousedown.stop>
    <div class="dialog-title">{{ dialogTitle }}</div>

    <div class="dialog-body">
      <!-- Name -->
      <div class="form-row">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" v-model="styleName" placeholder="Style name" :readonly="!isNew" />
      </div>

      <!-- Based on -->
      <div class="form-row">
        <label class="form-label">Based on</label>
        <div class="based-on-select" @click="showBasedOnDropdown = !showBasedOnDropdown">
          <span class="based-on-label">{{ basedOnLabel }}</span>
          <span class="caret">&#9662;</span>
          <div v-if="showBasedOnDropdown" class="based-on-dropdown">
            <div class="based-on-option" @click.stop="selectBasedOn('')">(no style)</div>
            <div
              v-for="s in basedOnOptions"
              :key="s.id"
              class="based-on-option"
              :class="{ active: basedOn === s.id }"
              @click.stop="selectBasedOn(s.id)"
            >
              {{ s.definition?.attrs?.name || s.id }}
            </div>
          </div>
        </div>
      </div>

      <!-- Heading level -->
      <div class="form-row">
        <label class="form-label">Heading</label>
        <div class="based-on-select" @click="showHeadingDropdown = !showHeadingDropdown">
          <span class="based-on-label">{{ headingLabel }}</span>
          <span class="caret">&#9662;</span>
          <div v-if="showHeadingDropdown" class="based-on-dropdown">
            <div
              v-for="opt in headingOptions"
              :key="opt.value"
              class="based-on-option"
              :class="{ active: headingLevel === opt.value }"
              @click.stop="selectHeading(opt.value)"
            >
              {{ opt.label }}
            </div>
          </div>
        </div>
      </div>

      <!-- Font family -->
      <div class="form-row">
        <label class="form-label">Font</label>
        <input type="text" class="form-input" v-model="fontFamily" placeholder="e.g. Arial" />
      </div>

      <!-- Font size -->
      <div class="form-row">
        <label class="form-label">Size</label>
        <input type="text" class="form-input form-input--small" v-model="fontSize" placeholder="e.g. 12pt" />
      </div>

      <!-- Bold / Italic / Underline -->
      <div class="form-row">
        <label class="form-label">Format</label>
        <div class="toggle-group">
          <button class="toggle-btn" :class="{ active: isBold }" @click="isBold = !isBold" title="Bold">
            <strong>B</strong>
          </button>
          <button class="toggle-btn" :class="{ active: isItalic }" @click="isItalic = !isItalic" title="Italic">
            <em>I</em>
          </button>
          <button
            class="toggle-btn"
            :class="{ active: isUnderline }"
            @click="isUnderline = !isUnderline"
            title="Underline"
          >
            <u>U</u>
          </button>
        </div>
      </div>

      <!-- Font color -->
      <div class="form-row">
        <label class="form-label">Color</label>
        <div class="color-input-wrapper">
          <input type="color" class="color-input" v-model="fontColor" />
          <span class="color-value">{{ fontColor }}</span>
        </div>
      </div>

      <!-- Text alignment -->
      <div class="form-row">
        <label class="form-label">Alignment</label>
        <div class="toggle-group">
          <button class="toggle-btn" :class="{ active: textAlign === 'left' }" @click="textAlign = 'left'" title="Left">
            &#8676;
          </button>
          <button
            class="toggle-btn"
            :class="{ active: textAlign === 'center' }"
            @click="textAlign = 'center'"
            title="Center"
          >
            &#8596;
          </button>
          <button
            class="toggle-btn"
            :class="{ active: textAlign === 'right' }"
            @click="textAlign = 'right'"
            title="Right"
          >
            &#8677;
          </button>
          <button
            class="toggle-btn"
            :class="{ active: textAlign === 'justify' }"
            @click="textAlign = 'justify'"
            title="Justify"
          >
            &#8700;
          </button>
        </div>
      </div>

      <!-- Preview -->
      <div class="form-row preview-row">
        <label class="form-label">Preview</label>
        <div class="preview-box" :style="previewStyle">The quick brown fox jumps over the lazy dog</div>
      </div>
    </div>

    <!-- Buttons -->
    <div class="dialog-footer">
      <button class="btn btn--cancel" @click="emit('cancel')">Cancel</button>
      <button class="btn btn--save" :class="{ disabled: !canSave }" @click="handleSave">OK</button>
    </div>
  </div>
</template>

<style scoped>
.modify-style-dialog {
  width: 340px;
  background: #fff;
  padding: 16px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #333;
}

.dialog-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-label {
  width: 70px;
  flex-shrink: 0;
  font-size: 12px;
  color: #555;
}

.form-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: #1355ff;
}

.form-input[readonly] {
  background: #f5f5f5;
  color: #888;
}

.form-input--small {
  width: 80px;
  flex: none;
}

/* Based-on dropdown */
.based-on-select {
  flex: 1;
  position: relative;
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}

.based-on-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  font-size: 10px;
  color: #888;
  margin-left: 4px;
}

.based-on-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 180px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 10;
  margin-top: 2px;
}

.based-on-option {
  padding: 6px 8px;
  cursor: pointer;
}

.based-on-option:hover {
  background-color: #e8edf3;
}

.based-on-option.active {
  background-color: #d0ddf0;
}

/* Toggle buttons */
.toggle-group {
  display: flex;
  gap: 4px;
}

.toggle-btn {
  width: 30px;
  height: 28px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #333;
  padding: 0;
}

.toggle-btn:hover {
  background-color: #e8edf3;
}

.toggle-btn.active {
  background-color: #d0ddf0;
  border-color: #1355ff;
  color: #1355ff;
}

/* Color input */
.color-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-input {
  width: 28px;
  height: 28px;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 1px;
  cursor: pointer;
  background: none;
}

.color-value {
  font-size: 12px;
  color: #666;
}

/* Preview */
.preview-row {
  align-items: flex-start;
  margin-top: 4px;
}

.preview-box {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fafafa;
  min-height: 40px;
  line-height: 1.4;
}

/* Footer */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  outline: none;
}

.btn--cancel {
  background: #fff;
  border: 1px solid #ccc;
  color: #333;
}

.btn--cancel:hover {
  background: #f0f0f0;
}

.btn--save {
  background: #1355ff;
  color: #fff;
}

.btn--save:hover {
  background: #0d47c1;
}

.btn--save.disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
