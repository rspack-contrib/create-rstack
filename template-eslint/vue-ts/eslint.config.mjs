import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import ts from 'typescript-eslint';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';

export default [
  { languageOptions: { globals: globals.browser } },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  ...defineConfigWithVueTs(vueTsConfigs.recommended),
  { ignores: ['dist/'] },
];
