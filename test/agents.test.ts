import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, beforeEach, test } from '@rstest/core';
import { create } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, 'temp');
const fixturesDir = path.join(__dirname, 'fixtures', 'agents-md');

beforeEach(() => {
  // Clean up test directory before each test
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  // Store original argv
  const originalArgv = process.argv;

  // Return cleanup function
  return () => {
    // Restore original argv and clean up
    process.argv = originalArgv;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  };
});

test('should generate AGENTS.md with no tools selected', async () => {
  const projectDir = path.join(testDir, 'no-tools');
  process.argv = ['node', 'test', '--dir', projectDir, '--template', 'vanilla'];

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    mapESLintTemplate: () => null,
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  assert.match(content, /## Template Info/);
  assert.match(content, /## Development/);
  // template-common has Tools section
  assert.match(content, /## Tools/);
  assert.match(content, /### Common Tools/);
});

test('should generate AGENTS.md with single tool selected', async () => {
  const projectDir = path.join(testDir, 'single-tool');
  process.argv = [
    'node',
    'test',
    '--dir',
    projectDir,
    '--template',
    'vanilla',
    '--tools',
    'biome',
  ];

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    mapESLintTemplate: () => null,
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  assert.match(content, /## Template Info/);
  assert.match(content, /## Development/);
  assert.match(content, /## Tools/);
  assert.match(content, /### Common Tools/); // from template-common
  assert.match(content, /### Biome/); // from template-biome
});

test('should generate AGENTS.md with eslint tool and template mapping', async () => {
  const projectDir = path.join(testDir, 'eslint-tool');
  process.argv = [
    'node',
    'test',
    '--dir',
    projectDir,
    '--template',
    'vanilla',
    '--tools',
    'eslint',
  ];

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    mapESLintTemplate: (templateName) => {
      if (templateName === 'vanilla') return 'vanilla-ts';
      return null;
    },
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  assert.match(content, /## Template Info/);
  assert.match(content, /## Development/);
  assert.match(content, /## Tools/);
  assert.match(content, /### ESLint/); // from template-eslint/AGENTS.md
});
