import { expect, test } from '@rstest/core';
import {
  checkCancel,
  create,
  multiselect,
  select,
  text,
} from '../dist/index.js';

test('should export public APIs', () => {
  expect(typeof checkCancel).toBe('function');
  expect(typeof create).toBe('function');
  expect(typeof multiselect).toBe('function');
  expect(typeof select).toBe('function');
  expect(typeof text).toBe('function');
});
