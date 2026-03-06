import { Extension } from '@core/Extension.js';
import { createSectionLockPlugin } from './section-lock-plugin.js';

export const SectionLock = Extension.create({
  name: 'sectionLock',

  addPmPlugins() {
    return [createSectionLockPlugin(this.editor)];
  },
});
