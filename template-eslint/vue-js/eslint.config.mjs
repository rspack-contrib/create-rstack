import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default defineConfig([
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,jsx,vue}'],
  },
  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),
  { languageOptions: { globals: globals.browser } },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
]);
