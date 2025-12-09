import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test } from '@rstest/core';
import { create } from '../src';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'cli');
const testDir = path.join(fixturesDir, 'test-temp-output');

beforeEach(() => {
  // Clean up test directory before each test
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  // Return cleanup function
  return () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  };
});

test('should accept comma separated tools option', async () => {
  const projectDir = path.join(testDir, 'comma-separated-tools');

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    argv: [
      'node',
      'test',
      '--dir',
      projectDir,
      '--template',
      'vanilla',
      '--tools',
      'eslint,prettier',
    ],
  });

  expect(fs.existsSync(path.join(projectDir, 'eslint.config.mjs'))).toBe(true);
  expect(fs.existsSync(path.join(projectDir, '.prettierrc'))).toBe(true);
});

test('should skip tools selection', async () => {
  const projectDir = path.join(testDir, 'comma-separated-tools');

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    argv: [
      'node',
      'test',
      '--dir',
      projectDir,
      '--template',
      'vanilla',
      '--tools',
      '""',
    ],
  });

  expect(fs.existsSync(path.join(projectDir, 'eslint.config.mjs'))).toBe(false);
  expect(fs.existsSync(path.join(projectDir, '.prettierrc'))).toBe(false);
});
