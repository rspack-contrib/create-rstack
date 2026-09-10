import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test } from 'rstack/test';
import { create } from '../src';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'agents-md');
const testDir = path.join(fixturesDir, 'test-temp-output-skills-ignore');

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  return () => fs.rmSync(testDir, { recursive: true, force: true });
});

test('should keep Prettier and Biome away from installed skills', async () => {
  const projectDir = path.join(testDir, 'formatters');

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
      'prettier,biome',
    ],
  });

  const prettierIgnore = fs.readFileSync(
    path.join(projectDir, '.prettierignore'),
    'utf-8',
  );
  expect(prettierIgnore).toContain('.agents');
  expect(prettierIgnore).toContain('skills-lock.json');

  const biomeConfig = JSON.parse(
    fs.readFileSync(path.join(projectDir, 'biome.json'), 'utf-8'),
  );
  expect(biomeConfig.files.includes).toEqual([
    '**',
    '!**/.agents',
    '!**/skills-lock.json',
  ]);
});
