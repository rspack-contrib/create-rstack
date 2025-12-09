import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@rstest/core';
import { create } from '../src';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'agents-md');
const testDir = path.join(fixturesDir, 'test-temp-output');

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
