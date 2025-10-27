import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cancel,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  text,
} from '@clack/prompts';
import deepmerge from 'deepmerge';
import minimist from 'minimist';
import color from 'picocolors';
import { logger } from 'rslog';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export { select, multiselect, text };

function cancelAndExit() {
  cancel('Operation cancelled.');
  process.exit(0);
}

export function checkCancel<T>(value: unknown) {
  if (isCancel(value)) {
    cancelAndExit();
  }
  return value as T;
}

/**
 * 1. Input: 'foo'
 *    Output: folder `<cwd>/foo`, `package.json#name` -> `foo`
 *
 * 2. Input: 'foo/bar'
 *    Output: folder -> `<cwd>/foo/bar` folder, `package.json#name` -> `bar`
 *
 * 3. Input: '@scope/foo'
 *    Output: folder -> `<cwd>/@scope/bar` folder, `package.json#name` -> `@scope/foo`
 *
 * 4. Input: './foo/bar'
 *    Output: folder -> `<cwd>/foo/bar` folder, `package.json#name` -> `bar`
 *
 * 5. Input: '/root/path/to/foo'
 *    Output: folder -> `'/root/path/to/foo'` folder, `package.json#name` -> `foo`
 */
function formatProjectName(input: string) {
  const formatted = input.trim().replace(/\/+$/g, '');
  return {
    packageName: formatted.startsWith('@')
      ? formatted
      : path.basename(formatted),
    targetDir: formatted,
  };
}

function pkgFromUserAgent(userAgent: string | undefined) {
  if (!userAgent) return undefined;
  const pkgSpec = userAgent.split(' ')[0];
  const pkgSpecArr = pkgSpec.split('/');
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  };
}

function isEmptyDir(path: string) {
  const files = fs.readdirSync(path);
  return files.length === 0 || (files.length === 1 && files[0] === '.git');
}

export type Argv = {
  help?: boolean;
  dir?: string;
  template?: string;
  override?: boolean;
  tools?: string | string[];
  'package-name'?: string;
};

function logHelpMessage(name: string, templates: string[]) {
  logger.log(`
   Usage: create-${name} [options]

   Options:
   
     -h, --help       display help for command
     -d, --dir        create project in specified directory
     -t, --template   specify the template to use
     --tools          select additional tools (biome, eslint, prettier)
     --override       override files in target directory
     --package-name   specify the package name
   
   Templates:

     ${templates.join(', ')}
`);
}

async function getTools({ tools, dir, template }: Argv) {
  if (tools) {
    return Array.isArray(tools) ? tools : [tools];
  }
  // skip tools selection when using CLI options
  if (dir && template) {
    return [];
  }
  // skip tools selection when tools is empty string
  if (tools === '') {
    return [];
  }

  return checkCancel<string[]>(
    await multiselect({
      message:
        'Select additional tools (Use <space> to select, <enter> to continue)',
      options: [
        { value: 'biome', label: 'Add Biome for code linting and formatting' },
        { value: 'eslint', label: 'Add ESLint for code linting' },
        { value: 'prettier', label: 'Add Prettier for code formatting' },
      ],
      required: false,
    }),
  );
}

function upperFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export type ESLintTemplateName =
  | 'vanilla-js'
  | 'vanilla-ts'
  | 'react-js'
  | 'react-ts'
  | 'vue-ts'
  | 'vue-js'
  | 'svelte-js'
  | 'svelte-ts';

const readJSON = async (path: string) =>
  JSON.parse(await fs.promises.readFile(path, 'utf-8'));

const readPackageJson = async (filePath: string) =>
  readJSON(path.join(filePath, 'package.json'));

export async function create({
  name,
  root,
  templates,
  skipFiles,
  getTemplateName,
  mapESLintTemplate,
  version,
  noteInformation,
}: {
  name: string;
  root: string;
  skipFiles?: string[];
  templates: string[];
  getTemplateName: (argv: Argv) => Promise<string>;
  mapESLintTemplate: (
    templateName: string,
    context: { distFolder: string },
  ) => ESLintTemplateName | null;
  version?: Record<string, string> | string;
  noteInformation?: string[];
}) {
  const argv = minimist<Argv>(process.argv.slice(2), {
    alias: { h: 'help', d: 'dir', t: 'template' },
  });

  console.log('');
  logger.greet(`◆  Create ${upperFirst(name)} Project`);

  if (argv.help) {
    logHelpMessage(name, templates);
    return;
  }

  const cwd = process.cwd();
  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
  const pkgManager = pkgInfo ? pkgInfo.name : 'npm';

  // No version provided, read from package.json
  if (!version) {
    version = (await readPackageJson(root)).version;
  }

  const projectName =
    argv.dir ??
    checkCancel<string>(
      await text({
        message: 'Project name or path',
        placeholder: `${name.toLowerCase()}-project`,
        defaultValue: `${name.toLowerCase()}-project`,
        validate(value) {
          if (value.length === 0) {
            return 'Project name is required';
          }
        },
      }),
    );

  const formatted = formatProjectName(projectName);
  const { targetDir } = formatted;
  const packageName = argv['package-name'] || formatted.packageName;
  const distFolder = path.isAbsolute(targetDir)
    ? targetDir
    : path.join(cwd, targetDir);

  if (!argv.override && fs.existsSync(distFolder) && !isEmptyDir(distFolder)) {
    const option = checkCancel<string>(
      await select({
        message: `"${targetDir}" is not empty, please choose:`,
        options: [
          { value: 'yes', label: 'Continue and override files' },
          { value: 'no', label: 'Cancel operation' },
        ],
      }),
    );

    if (option === 'no') {
      cancelAndExit();
    }
  }

  const templateName = await getTemplateName(argv);
  const tools = await getTools(argv);

  const srcFolder = path.join(root, `template-${templateName}`);
  const commonFolder = path.join(root, 'template-common');

  if (!fs.existsSync(srcFolder)) {
    throw new Error(`Invalid input: template "${templateName}" not found.`);
  }

  copyFolder({
    from: commonFolder,
    to: distFolder,
    version,
    skipFiles,
  });
  copyFolder({
    from: srcFolder,
    to: distFolder,
    version,
    packageName,
    skipFiles,
  });

  const packageRoot = path.resolve(__dirname, '..');
  const agentsMdSearchDirs = [srcFolder, commonFolder];

  for (const tool of tools) {
    const toolFolder = path.join(packageRoot, `template-${tool}`);

    if (tool === 'eslint') {
      const eslintTemplateName = mapESLintTemplate(templateName, {
        distFolder,
      });

      if (!eslintTemplateName) {
        continue;
      }

      const subFolder = path.join(toolFolder, eslintTemplateName);
      copyFolder({
        from: subFolder,
        to: distFolder,
        version,
        skipFiles,
        isMergePackageJson: true,
      });

      agentsMdSearchDirs.push(toolFolder);
      agentsMdSearchDirs.push(subFolder);
      continue;
    }

    copyFolder({
      from: toolFolder,
      to: distFolder,
      version,
      skipFiles,
      isMergePackageJson: true,
    });

    agentsMdSearchDirs.push(toolFolder);

    if (tool === 'biome') {
      await fs.promises.rename(
        path.join(distFolder, 'biome.json.template'),
        path.join(distFolder, 'biome.json'),
      );
    }
  }

  const agentsFiles = collectAgentsFiles(agentsMdSearchDirs);
  if (agentsFiles.length > 0) {
    const mergedAgents = mergeAgentsFiles(agentsFiles);
    const agentsPath = path.join(distFolder, 'AGENTS.md');
    fs.writeFileSync(agentsPath, `${mergedAgents}\n`);
  }

  const nextSteps = noteInformation
    ? noteInformation
    : [
        `1. ${color.cyan(`cd ${targetDir}`)}`,
        `2. ${color.cyan('git init')} ${color.dim('(optional)')}`,
        `3. ${color.cyan(`${pkgManager} install`)}`,
        `4. ${color.cyan(`${pkgManager} run dev`)}`,
      ];

  if (nextSteps.length) {
    note(nextSteps.map((step) => color.reset(step)).join('\n'), 'Next steps');
  }

  outro('All set, happy coding!');
}

function sortObjectKeys(obj: Record<string, unknown>) {
  const sortedKeys = Object.keys(obj).sort();

  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = obj[key];
  }

  return sortedObj;
}

/**
 * Merge two package.json files and keep the order of keys.
 * @param targetPackage Path to the base package.json file
 * @param extraPackage Path to the extra package.json file to merge
 */
export function mergePackageJson(targetPackage: string, extraPackage: string) {
  if (!fs.existsSync(targetPackage)) {
    return;
  }

  const targetJson = JSON.parse(fs.readFileSync(targetPackage, 'utf-8'));
  const extraJson = JSON.parse(fs.readFileSync(extraPackage, 'utf-8'));
  const mergedJson: Record<string, unknown> = deepmerge(targetJson, extraJson);

  mergedJson.name = targetJson.name || extraJson.name;

  for (const key of ['scripts', 'dependencies', 'devDependencies']) {
    if (!(key in mergedJson)) {
      continue;
    }
    mergedJson[key] = sortObjectKeys(
      mergedJson[key] as Record<string, unknown>,
    );
  }

  fs.writeFileSync(targetPackage, `${JSON.stringify(mergedJson, null, 2)}\n`);
}

/**
 * Copy files from one folder to another.
 * @param from Source folder
 * @param to Destination folder
 * @param version - Optional. The version to update in the package.json. If not provided, version will not be updated.
 * @param name - Optional. The name to update in the package.json. If not provided, name will not be updated.
 * @param isMergePackageJson Merge package.json files
 * @param skipFiles Files to skip
 */
export function copyFolder({
  from,
  to,
  version,
  packageName,
  isMergePackageJson,
  skipFiles = [],
}: {
  from: string;
  to: string;
  version?: string | Record<string, string>;
  packageName?: string;
  isMergePackageJson?: boolean;
  skipFiles?: string[];
}) {
  const renameFiles: Record<string, string> = {
    gitignore: '.gitignore',
  };

  // Skip local files
  const allSkipFiles = ['node_modules', 'dist', ...skipFiles];

  fs.mkdirSync(to, { recursive: true });

  for (const file of fs.readdirSync(from)) {
    if (allSkipFiles.includes(file)) {
      continue;
    }

    const srcFile = path.resolve(from, file);
    const distFile = renameFiles[file]
      ? path.resolve(to, renameFiles[file])
      : path.resolve(to, file);
    const stat = fs.statSync(srcFile);

    if (stat.isDirectory()) {
      copyFolder({
        from: srcFile,
        to: distFile,
        version,
        skipFiles,
      });
    } else if (file === 'package.json') {
      const targetPackage = path.resolve(to, 'package.json');

      if (isMergePackageJson && fs.existsSync(targetPackage)) {
        mergePackageJson(targetPackage, srcFile);
      } else {
        fs.copyFileSync(srcFile, distFile);
      }
      updatePackageJson(distFile, version, packageName);
    } else {
      fs.copyFileSync(srcFile, distFile);
    }
  }
}

const isStableVersion = (version: string) => {
  return ['alpha', 'beta', 'rc', 'canary', 'nightly'].every(
    (tag) => !version.includes(tag),
  );
};

/**
 * Updates the package.json file at the specified path with the provided version and name.
 *
 * @param pkgJsonPath - The file path to the package.json file.
 * @param version - Optional. The version to update in the package.json. If not provided, version will not be updated.
 * @param name - Optional. The name to update in the package.json. If not provided, name will not be updated.
 */
const updatePackageJson = (
  pkgJsonPath: string,
  version?: string | Record<string, string>,
  name?: string,
) => {
  let content = fs.readFileSync(pkgJsonPath, 'utf-8');

  if (typeof version === 'string') {
    // Lock the version if it is not stable
    const targetVersion = isStableVersion(version) ? `^${version}` : version;
    content = content.replace(/workspace:\*/g, targetVersion);
  }

  const pkg = JSON.parse(content);

  if (typeof version === 'object') {
    for (const [name, ver] of Object.entries(version)) {
      if (pkg.dependencies?.[name]) {
        pkg.dependencies[name] = ver;
      }
      if (pkg.devDependencies?.[name]) {
        pkg.devDependencies[name] = ver;
      }
    }
  }

  if (name && name !== '.') {
    pkg.name = name;
  }

  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

/**
 * Read AGENTS.md files from template directories
 */
function readAgentsFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Parse AGENTS.md content and extract sections
 */
function parseAgentsContent(
  content: string,
): Record<string, { title: string; content: string; level: number }> {
  const sections: Record<
    string,
    { title: string; content: string; level: number }
  > = {};
  const lines = content.split('\n');
  let currentKey = '';
  let currentTitle = '';
  let currentLevel = 0;
  let currentContent: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^(#{1,2})\s+(.+)$/);
    if (sectionMatch) {
      if (currentKey) {
        sections[currentKey] = {
          title: currentTitle,
          level: currentLevel,
          content: currentContent.join('\n').trim(),
        };
      }
      currentLevel = sectionMatch[1].length;
      currentTitle = sectionMatch[2].trim();
      currentKey = `${currentLevel}-${currentTitle.toLowerCase()}`;
      currentContent = [];
    } else if (currentKey) {
      currentContent.push(line);
    }
  }

  if (currentKey) {
    sections[currentKey] = {
      title: currentTitle,
      level: currentLevel,
      content: currentContent.join('\n').trim(),
    };
  }

  return sections;
}

/**
 * Merge AGENTS.md files from multiple sources
 */
function mergeAgentsFiles(agentsFiles: string[]): string {
  const allSections: Record<
    string,
    { title: string; level: number; contents: string[] }
  > = {};

  for (const fileContent of agentsFiles) {
    if (!fileContent) continue;
    const sections = parseAgentsContent(fileContent);

    for (const [key, section] of Object.entries(sections)) {
      if (!allSections[key]) {
        allSections[key] = {
          title: section.title,
          level: section.level,
          contents: [],
        };
      }
      if (
        section.content &&
        !allSections[key].contents.includes(section.content)
      ) {
        allSections[key].contents.push(section.content);
      }
    }
  }

  const result: string[] = [];

  for (const [, section] of Object.entries(allSections)) {
    result.push(`${'#'.repeat(section.level)} ${section.title}`);
    result.push('');
    for (const content of section.contents) {
      result.push(content);
      result.push('');
    }
  }

  return result.join('\n').trim();
}

/**
 * Collect AGENTS.md files from template directories
 */
function collectAgentsFiles(agentsMdSearchDirs: string[]): string[] {
  const agentsFiles: string[] = [];

  for (const dir of agentsMdSearchDirs) {
    const agentsContent = readAgentsFile(path.join(dir, 'AGENTS.md'));
    if (agentsContent) {
      agentsFiles.push(agentsContent);
    }
  }

  return agentsFiles;
}
