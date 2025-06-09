import { assert, test } from '@rstest/core';
import {
  checkCancel,
  create,
  multiselect,
  select,
  text,
} from '../dist/index.js';

test('should export public APIs', () => {
  assert.deepStrictEqual(typeof checkCancel, 'function');
  assert.deepStrictEqual(typeof create, 'function');
  assert.deepStrictEqual(typeof multiselect, 'function');
  assert.deepStrictEqual(typeof select, 'function');
  assert.deepStrictEqual(typeof text, 'function');
});
