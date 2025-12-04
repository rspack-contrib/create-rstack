import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test } from '@rstest/core';
import fse from 'fs-extra';
import { create } from '../src';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'basic');
const testDir = path.join(fixturesDir, 'test-temp-output');

beforeEach(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  return () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  };
});

test('should run extra tool action', async () => {
  const projectDir = path.join(testDir, 'extra-tool-action');
  let actionCalled = false;

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    extraTools: [
      {
        value: 'custom-action',
        label: 'Custom Action',
        action: () => {
          actionCalled = true;
        },
      },
    ],
    argv: [
      'node',
      'test',
      '--dir',
      projectDir,
      '--template',
      'vanilla',
      '--tools',
      'custom-action',
    ],
  });

  expect(actionCalled).toBe(true);
});

test('should run extra tool command', async () => {
  const projectDir = path.join(testDir, 'extra-tool-command');
  const testFile = path.join(__dirname, 'node_modules', 'test.txt');

  await fse.outputFile(testFile, '');
  expect(fs.existsSync(testFile)).toBe(true);

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    extraTools: [
      {
        value: 'custom-command',
        label: 'Custom Command',
        command: `npx rimraf ${testFile}`,
      },
    ],
    argv: [
      'node',
      'test',
      '--dir',
      projectDir,
      '--template',
      'vanilla',
      '--tools',
      'custom-command',
    ],
  });

  expect(fs.existsSync(testFile)).toBe(false);
});
