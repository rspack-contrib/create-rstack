import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, beforeEach, expect, test } from 'rstack/test';
import { create, mergeAgentsFiles } from '../src';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'agents-md');
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

test('should generate AGENTS.md with no tools selected', async () => {
  const projectDir = path.join(testDir, 'no-tools');

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    argv: ['node', 'test', '--dir', projectDir, '--template', 'vanilla'],
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  expect(content).toMatchInlineSnapshot(`
    "# Project Overview

    This section provides common guidance for all templates.

    ## Development

    ### Common Development

    - Common development instructions
    - Available in all templates

    ## Tools

    ### Common Tools

    - Tools that apply to all templates

    ### Rstest

    - Run \`pnpm run test\` to test your code

    ## Template Info

    ### Vanilla Template

    - This is vanilla template specific content
    - Only available in vanilla template
    "
  `);
});

test('should generate AGENTS.md with single tool selected', async () => {
  const projectDir = path.join(testDir, 'single-tool');

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
      'biome',
    ],
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  expect(content).toMatchInlineSnapshot(`
    "# Project Overview

    This section provides common guidance for all templates.

    ## Development

    ### Common Development

    - Common development instructions
    - Available in all templates

    ## Tools

    ### Common Tools

    - Tools that apply to all templates

    ### Rstest

    - Run \`pnpm run test\` to test your code

    ### Biome

    - Run \`pnpm run check\` to lint your code
    - Run \`pnpm run format\` to format your code

    ## Template Info

    ### Vanilla Template

    - This is vanilla template specific content
    - Only available in vanilla template
    "
  `);
});

test('should generate AGENTS.md with rslint tool selected', async () => {
  const projectDir = path.join(testDir, 'rslint-tool');

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
      'rslint',
    ],
  });

  const content = fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf-8');
  expect(content).toMatchInlineSnapshot(`
    "# Project Overview

    This section provides common guidance for all templates.

    ## Development

    ### Common Development

    - Common development instructions
    - Available in all templates

    ## Tools

    ### Common Tools

    - Tools that apply to all templates

    ### Rstest

    - Run \`pnpm run test\` to test your code

    ### Rslint

    - Run \`pnpm run lint\` to lint your code

    ## Template Info

    ### Vanilla Template

    - This is vanilla template specific content
    - Only available in vanilla template

    ## Docs

    - Rslint: https://rslint.rs/llms.txt
    "
  `);
});

test('should generate AGENTS.md with eslint tool and template mapping', async () => {
  const projectDir = path.join(testDir, 'eslint-tool');

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    mapESLintTemplate: (templateName) => {
      if (templateName === 'vanilla') return 'vanilla-ts';
      return null;
    },
    argv: [
      'node',
      'test',
      '--dir',
      projectDir,
      '--template',
      'vanilla',
      '--tools',
      'eslint',
    ],
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  expect(content).toMatchInlineSnapshot(`
    "# Project Overview

    This section provides common guidance for all templates.

    ## Development

    ### Common Development

    - Common development instructions
    - Available in all templates

    ## Tools

    ### Common Tools

    - Tools that apply to all templates

    ### Rstest

    - Run \`pnpm run test\` to test your code

    ### ESLint

    - Run \`pnpm run lint\` to lint your code

    ## Template Info

    ### Vanilla Template

    - This is vanilla template specific content
    - Only available in vanilla template
    "
  `);
});

test('should merge top-level sections from AGENTS.md files', async () => {
  const projectDir = path.join(testDir, 'h1-support');

  await create({
    name: 'test',
    root: fixturesDir,
    templates: ['vanilla'],
    getTemplateName: async () => 'vanilla',
    argv: ['node', 'test', '--dir', projectDir, '--template', 'vanilla'],
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  assert.strictEqual(fs.existsSync(agentsPath), true);

  const content = fs.readFileSync(agentsPath, 'utf-8');
  expect(content).toMatchInlineSnapshot(`
    "# Project Overview

    This section provides common guidance for all templates.

    ## Development

    ### Common Development

    - Common development instructions
    - Available in all templates

    ## Tools

    ### Common Tools

    - Tools that apply to all templates

    ### Rstest

    - Run \`pnpm run test\` to test your code

    ## Template Info

    ### Vanilla Template

    - This is vanilla template specific content
    - Only available in vanilla template
    "
  `);
});

test('mergeAgentsFiles should handle unordered lists without extra newline', () => {
  const file1 = `
## Tools

- item 1
- item 2
`;
  const file2 = `
## Tools

- item 3
`;

  const merged = mergeAgentsFiles([file1, file2]);

  expect(merged).toMatchInlineSnapshot(`
    "## Tools

    - item 1
    - item 2
    - item 3"
  `);
});

test('mergeAgentsFiles should still add newline for non-list content', () => {
  const file1 = `
## Tools

Some intro text.
`;
  const file2 = `
## Tools

More text.
`;

  const merged = mergeAgentsFiles([file1, file2]);

  expect(merged).toMatchInlineSnapshot(`
    "## Tools

    Some intro text.

    More text."
  `);
});

test('mergeAgentsFiles should not skip newline for horizontal rules (---)', () => {
  const file1 = `
## Tools

---
`;
  const file2 = `
## Tools

- item 1
`;

  const merged = mergeAgentsFiles([file1, file2]);

  expect(merged).toMatchInlineSnapshot(`
    "## Tools

    ---

    - item 1"
  `);
});

test('mergeAgentsFiles should add newline when paragraph is followed by list', () => {
  const file1 = `
## Tools

Some intro text.
`;
  const file2 = `
## Tools

- item 1
`;

  const merged = mergeAgentsFiles([file1, file2]);

  // Revised requirement: Paragraph followed by list SHOULD have a newline.
  expect(merged).toMatchInlineSnapshot(`
    "## Tools

    Some intro text.

    - item 1"
  `);
});
