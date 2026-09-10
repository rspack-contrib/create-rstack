import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test } from 'rstack/test';
import { create } from '../src';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'agents-md');
const testDir = path.join(fixturesDir, 'test-temp-output-tool-scripts');

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  return () => fs.rmSync(testDir, { recursive: true, force: true });
});

async function createWithTools(name: string, tools: string) {
  const projectDir = path.join(testDir, name);

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
      tools,
    ],
  });

  return JSON.parse(
    fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'),
  ).scripts;
}

test('should run both linters when ESLint and Rslint are selected', async () => {
  const scripts = await createWithTools('eslint-rslint', 'eslint,rslint');
  expect(scripts.lint).toBe('eslint . && rslint');
});

test('should run both formatters when Biome and Prettier are selected', async () => {
  const scripts = await createWithTools('biome-prettier', 'biome,prettier');
  expect(scripts.format).toBe('biome format --write && prettier --write .');
});

test('should keep a single tool script unchanged', async () => {
  const scripts = await createWithTools('eslint', 'eslint');
  expect(scripts.lint).toBe('eslint .');
});
