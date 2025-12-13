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
import { determineAgent } from '@vercel/detect-agent';
import spawn from 'cross-spawn';
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

function parseToolsOption(tools: Argv['tools']) {
  if (typeof tools === 'undefined') {
    return null;
  }

  const toolsArr = Array.isArray(tools) ? tools : [tools];

  return toolsArr
    .flatMap((tool) => tool.split(','))
    .map((tool) => tool.trim())
    .filter(Boolean);
}

export type Argv = {
  help?: boolean;
  dir?: string;
  template?: string;
  override?: boolean;
  tools?: string | string[];
  packageName?: string;
  'package-name'?: string;
};

export const BUILTIN_TOOLS = ['biome', 'eslint', 'prettier'];

function logHelpMessage(
  name: string,
  templates: string[],
  extraTools?: ExtraTool[],
) {
  const extraToolNames = extraTools?.map((tool) => tool.value) ?? [];
  const toolsList = [...BUILTIN_TOOLS, ...extraToolNames].join(', ');

  logger.log(`
   Usage: create-${name} [dir] [options]

   Options:
   
     -h, --help            display help for command
     -d, --dir <dir>       create project in specified directory
     -t, --template <tpl>  specify the template to use
     --tools <tool>        select additional tools (${toolsList})
     --override            override files in target directory
     --packageName <name>  specify the package name
   
   Templates:

     ${templates.join(', ')}
`);
}

async function getTools(
  { tools, dir, template }: Argv,
  extraTools?: ExtraTool[],
) {
  // Check if tools are specified via CLI options
  const parsedTools = parseToolsOption(tools);

  if (parsedTools !== null) {
    const toolsArr = parsedTools.filter(
      (tool) =>
        BUILTIN_TOOLS.includes(tool) ||
        extraTools?.some((extraTool) => extraTool.value === tool),
    );
    return toolsArr;
  }
  // skip tools selection when using CLI options
  if (dir && template) {
    return [];
  }

  const options = [
    { value: 'biome', label: 'Biome - linting & formatting' },
    { value: 'eslint', label: 'ESLint - linting' },
    { value: 'prettier', label: 'Prettier - formatting' },
  ];

  if (extraTools) {
    const normalize = (tool: ExtraTool) => ({
      value: tool.value,
      label: tool.label,
      hint: tool.command,
    });
    options.unshift(
      ...extraTools.filter((tool) => tool.order === 'pre').map(normalize),
    );
    options.push(
      ...extraTools.filter((tool) => tool.order !== 'pre').map(normalize),
    );
  }

  return checkCancel<string[]>(
    await multiselect({
      message:
        'Select additional tools (Use <space> to select, <enter> to continue)',
      options,
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

const parseArgv = (processArgv: string[]) => {
  const argv = minimist<Argv>(processArgv.slice(2), {
    alias: { h: 'help', d: 'dir', t: 'template' },
  });

  // Set dir to first argument if not specified via `--dir`
  if (!argv.dir && argv._[0]) {
    argv.dir = argv._[0];
  }

  if (argv['package-name']) {
    argv.packageName = argv['package-name'];
  }

  return argv;
};

type ExtraTool = {
  /**
   * The value of the multiselect option.
   */
  value: string;
  /**
   * The label of the multiselect option.
   */
  label: string;
  /**
   * The action to perform when the tool is selected.
   */
  action?: (context: {
    templateName: string;
    distFolder: string;
    addAgentsMdSearchDirs: (dir: string) => void;
  }) => unknown;
  /**
   * The custom command to run when the tool is selected.
   */
  command?: string;
  /**
   * Specify where to display this tool.
   * If undefined, the tool will be displayed after built-in tools.
  order?: 'pre' | 'post';
};

function runCommand(command: string, cwd: string, packageManager: string) {
  // Replace `npm create` with the equivalent command for the detected package manager
  if (command.startsWith('npm create ')) {
    const createReplacements: Record<string, string> = {
      bun: 'bun create ',
      pnpm: 'pnpm create ',
      yarn: 'yarn create ',
      deno: 'deno run -A npm:create-',
    };
    const replacement = createReplacements[packageManager];
    if (replacement) {
      command = command
        .replace('npm create ', replacement)
        // other package managers don't need the extra `--`
        .replace(' -- --', ' --');
    }
    // Yarn v1 does not support `@latest` tag
    if (packageManager === 'yarn') {
      command = command.replace('@latest', '');
    }
  }

  const [bin, ...args] = command.split(' ');
  spawn.sync(bin, args, {
    stdio: 'inherit',
    cwd,
  });
}

export async function create({
  name,
  root,
  templates,
  skipFiles,
  getTemplateName,
  mapESLintTemplate,
  version,
  noteInformation,
  extraTools,
  argv: processArgv = process.argv,
}: {
  name: string;
  root: string;
  skipFiles?: string[];
  templates: string[];
  getTemplateName: (argv: Argv) => Promise<string>;
  /**
   * Map the template name to the ESLint template name.
   * If not provided, defaults to 'vanilla-ts' for all templates.
   */
  mapESLintTemplate?: (
    templateName: string,
    context: { distFolder: string },
  ) => ESLintTemplateName | null;
  version?: Record<string, string> | string;
  noteInformation?: string[];
  /**
   * Specify additional tools.
   */
  extraTools?: ExtraTool[];
  /**
   * For test purpose, override the default argv (process.argv).
   */
  argv?: string[];
}) {
  logger.greet(`\n◆  Create ${upperFirst(name)} Project`);

  const { isAgent } = await determineAgent();
  if (isAgent) {
    console.log('');
    logger.info(
      `To create a project non-interactively, run: npx -y create-${name} <DIR> --template <TEMPLATE>`,
    );
  }

  const argv = parseArgv(processArgv);

  if (argv.help) {
    logHelpMessage(name, templates, extraTools);
    return;
  }

  const cwd = process.cwd();
  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
  const packageManager = pkgInfo ? pkgInfo.name : 'npm';
  const templateParameters = { packageManager };

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
  const packageName = argv.packageName || formatted.packageName;
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
  const tools = await getTools(argv, extraTools);

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
    templateParameters,
  });
  copyFolder({
    from: srcFolder,
    to: distFolder,
    version,
    packageName,
    templateParameters,
    skipFiles,
  });

  const packageRoot = path.resolve(__dirname, '..');
  const agentsMdSearchDirs = [commonFolder, srcFolder];

  for (const tool of tools) {
    // Handle extra tools first
    if (extraTools) {
      const matchedTool = extraTools.find(
        (extraTool) => extraTool.value === tool,
      );
      if (matchedTool) {
        if (matchedTool.action) {
          await matchedTool.action({
            templateName,
            distFolder,
            addAgentsMdSearchDirs: (dir: string) =>
              agentsMdSearchDirs.push(dir),
          });
        }
        if (matchedTool.command) {
          runCommand(matchedTool.command, distFolder, packageManager);
        }
        continue;
      }
    }

    // Handle built-in tools
    const toolFolder = path.join(packageRoot, `template-${tool}`);

    if (tool === 'eslint') {
      const eslintTemplateName = mapESLintTemplate
        ? mapESLintTemplate(templateName, {
            distFolder,
          })
        : 'vanilla-ts';

      if (!eslintTemplateName) {
        continue;
      }

      const subFolder = path.join(toolFolder, eslintTemplateName);
      copyFolder({
        from: subFolder,
        to: distFolder,
        version,
        skipFiles,
        templateParameters,
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
      templateParameters,
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
    fs.writeFileSync(
      agentsPath,
      `${replacePlaceholder(mergedAgents, templateParameters)}\n`,
    );
  }

  const nextSteps = noteInformation
    ? noteInformation
    : [
        `1. ${color.cyan(`cd ${targetDir}`)}`,
        `2. ${color.cyan('git init')} ${color.dim('(optional)')}`,
        `3. ${color.cyan(`${packageManager} install`)}`,
        `4. ${color.cyan(`${packageManager} run dev`)}`,
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

const isMarkdown = (file: string) =>
  file.endsWith('.md') || file.endsWith('.mdx');

const replacePlaceholder = (
  content: string,
  templateParameters: Record<string, string>,
) => {
  let result = content;
  for (const key of Object.keys(templateParameters)) {
    result = result.replace(
      new RegExp(`{{ ${key} }}`, 'g'),
      templateParameters[key],
    );
  }
  return result;
};

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
  templateParameters,
  isMergePackageJson,
  skipFiles = [],
}: {
  from: string;
  to: string;
  version?: string | Record<string, string>;
  packageName?: string;
  templateParameters?: Record<string, string>;
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
        templateParameters,
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

      if (templateParameters && isMarkdown(distFile)) {
        const content = fs.readFileSync(distFile, 'utf-8');
        fs.writeFileSync(
          distFile,
          replacePlaceholder(content, templateParameters),
        );
      }
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

  if (name === '.') {
    const projectName = path.basename(path.dirname(pkgJsonPath));
    if (projectName.length) {
      pkg.name = projectName;
    }
  } else if (name) {
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
export function mergeAgentsFiles(agentsFiles: string[]): string {
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
export function collectAgentsFiles(agentsMdSearchDirs: string[]): string[] {
  const agentsFiles: string[] = [];

  for (const dir of agentsMdSearchDirs) {
    const agentsContent = readAgentsFile(path.join(dir, 'AGENTS.md'));
    if (agentsContent) {
      agentsFiles.push(agentsContent);
    }
  }

  return agentsFiles;
}
