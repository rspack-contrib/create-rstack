import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, beforeEach, test } from '@rstest/core';
import fse from 'fs-extra';
import { create } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, 'temp');
const fixturesDir = path.join(__dirname, 'fixtures', 'basic');

beforeEach(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const originalArgv = process.argv;

  return () => {
    process.argv = originalArgv;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  };
});

test('should run extra tool action', async () => {
  const projectDir = path.join(testDir, 'extra-tool-action');
  let actionCalled = false;

  process.argv = [
    'node',
    'test',
    '--dir',
    projectDir,
    '--template',
    'vanilla',
    '--tools',
    'custom-action',
  ];

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
  });

  assert.strictEqual(actionCalled, true);
});

test('should run extra tool command', async () => {
  const projectDir = path.join(testDir, 'extra-tool-command');
  const touchedFile = path.join(projectDir, 'touched-by-command.txt');

  await fse.remove(touchedFile);

  process.argv = [
    'node',
    'test',
    '--dir',
    projectDir,
    '--template',
    'vanilla',
    '--tools',
    'custom-command',
  ];

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    extraTools: [
      {
        value: 'custom-command',
        label: 'Custom Command',
        command: 'touch touched-by-command.txt',
      },
    ],
  });

  assert.strictEqual(fs.existsSync(touchedFile), true);
});
