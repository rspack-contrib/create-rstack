import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  autocomplete,
  cancel,
  groupMultiselect,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  taskLog,
  text,
} from '@clack/prompts';
import { determineAgent } from '@vercel/detect-agent';
import deepmerge from 'deepmerge';
import minimist from 'minimist';
import { color, logger } from 'rslog';
import { x, xSync } from 'tinyexec';
import {
  getAgentCreateCommand,
  replaceCreateCommand,
} from './package-manager.js';
import { isNpmTemplate, resolveCustomTemplate } from './template-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export { autocomplete, groupMultiselect, multiselect, select, text };

// Export npm template utilities
export {
  isNpmTemplate,
  resolveCustomTemplate,
  resolveNpmTemplate,
  sanitizeCacheKey,
} from './template-manager.js';

function cancelAndExit() {
  cancel('Operation cancelled');
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

const PACKAGE_MANAGER_FILES = [
  { file: 'pnpm-workspace.yaml', packageManager: 'pnpm' },
];

function getPackageManagerSkipFiles(packageManager: string) {
  return PACKAGE_MANAGER_FILES.filter(
    (item) => item.packageManager !== packageManager,
  ).map((item) => item.file);
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

function parseSkillsOption(skills: Argv['skill']) {
  if (typeof skills === 'undefined') {
    return null;
  }

  const skillsArr = Array.isArray(skills) ? skills : [skills];

  return skillsArr
    .flatMap((skill) => skill.split(','))
    .map((skill) => skill.trim())
    .filter(Boolean);
}

export type Argv = {
  help?: boolean;
  dir?: string;
  template?: string;
  git?: boolean;
  override?: boolean;
  tools?: string | string[];
  skill?: string | string[];
  packageName?: string;
  'package-name'?: string;
  templateVersion?: string;
  'template-version'?: string;
};

export type GitContext = {
  /** Whether Git initialization is enabled for the generated project. */
  gitEnabled: boolean;
  /** Whether the generated project is the root of its Git worktree. */
  isGitRoot: boolean;
};

export type GitResolvedContext = GitContext & {
  templateName: string;
  distFolder: string;
};

export type BuiltinToolName = 'eslint' | 'rslint' | 'biome' | 'prettier';

export const BUILTIN_TOOLS: BuiltinToolName[] = [
  'eslint',
  'rslint',
  'biome',
  'prettier',
];

type ToolOption = {
  value: string;
  label: string;
  hint?: string;
};

const BUILTIN_TOOL_OPTIONS: Array<ToolOption & { value: BuiltinToolName }> = [
  { value: 'rslint', label: 'Rslint - linting' },
  { value: 'eslint', label: 'ESLint - linting' },
  { value: 'prettier', label: 'Prettier - formatting' },
  { value: 'biome', label: 'Biome - linting & formatting' },
];

function resolveBuiltinTools(
  builtinTools: BuiltinToolName[] | undefined,
): BuiltinToolName[] {
  if (Array.isArray(builtinTools)) {
    const selectedTools = new Set(builtinTools);
    return BUILTIN_TOOLS.filter((tool) => selectedTools.has(tool));
  }

  return [...BUILTIN_TOOLS];
}

function logHelpMessage(
  name: string,
  templates: string[],
  git: boolean,
  builtinTools: BuiltinToolName[] | undefined,
  extraTools?: ExtraTool[],
  extraSkills?: ExtraSkill[],
) {
  const toolsList: string[] = resolveBuiltinTools(builtinTools);
  // Keep help output exhaustive for discoverability. `skill.when` only gates
  // the interactive prompt, not the documented list of available skills.
  const skillsList = (extraSkills ?? [])
    .map((skill) => skill.value)
    .filter(Boolean);
  const hasSkills = skillsList.length > 0;
  if (extraTools) {
    for (const tool of extraTools) {
      if (!tool.value) {
        continue;
      }
      if (tool.order === 'pre') {
        toolsList.unshift(tool.value);
      } else {
        toolsList.push(tool.value);
      }
    }
  }

  const hasTools = toolsList.length > 0;
  const options: [flags: string, description: string][] = [
    ['-h, --help', 'display help for command'],
    ['-d, --dir <dir>', 'create project in specified directory'],
    ['-t, --template <tpl>', 'specify the template to use'],
  ];

  if (git) {
    options.push(['--no-git', 'skip Git repository initialization']);
  }
  if (hasTools) {
    options.push(['--tools <tool>', 'add additional tools, comma separated']);
  }
  if (hasSkills) {
    options.push(['--skill <skill>', 'add optional skills, comma separated']);
  }

  options.push(
    ['--override', 'override files in target directory'],
    ['--package-name <name>', 'specify the package name'],
    ['--template-version <ver>', 'specify the npm template version'],
  );

  const optionWidth = Math.max(...options.map(([flags]) => flags.length));
  const optionLines = options
    .map(
      ([flags, description]) =>
        `  ${flags.padEnd(optionWidth)}  ${description}`,
    )
    .join('\n');
  const helpSections = [
    `Usage: create-${name} [dir] [options]`,
    '',
    'Options:',
    optionLines,
    '',
    `Available templates: ${templates.join(', ')}`,
  ];

  if (hasTools) {
    helpSections.push('', `Optional tools: ${toolsList.join(', ')}`);
  }
  if (hasSkills) {
    helpSections.push('', `Optional skills: ${skillsList.join(', ')}`);
  }

  logger.log(helpSections.join('\n'));
}

async function getTools(
  { tools, dir, template }: Argv,
  builtinTools: BuiltinToolName[] | undefined,
  extraTools?: ExtraTool[],
  templateName?: string,
) {
  // Check if tools are specified via CLI options
  const parsedTools = parseToolsOption(tools);
  const enabledBuiltinTools = resolveBuiltinTools(builtinTools);
  const enabledBuiltinToolSet = new Set<string>(enabledBuiltinTools);

  // Filter extraTools based on templateName
  const filteredExtraTools = extraTools?.filter((tool) => {
    const when = tool.when ?? (() => true);
    return templateName ? when({ templateName }) : true;
  });

  if (parsedTools !== null) {
    const toolsArr = parsedTools.filter(
      (tool) =>
        enabledBuiltinToolSet.has(tool) ||
        filteredExtraTools?.some((extraTool) => extraTool.value === tool),
    );
    return toolsArr;
  }
  // skip tools selection when using CLI options
  if (dir && template) {
    return [];
  }

  const options: ToolOption[] = BUILTIN_TOOL_OPTIONS.filter(({ value }) =>
    enabledBuiltinToolSet.has(value),
  );

  if (filteredExtraTools) {
    const normalize = (tool: ExtraTool) => ({
      value: tool.value,
      label: tool.label,
      hint: tool.command,
    });
    options.unshift(
      ...filteredExtraTools
        .filter((tool) => tool.order === 'pre')
        .map(normalize),
    );
    options.push(
      ...filteredExtraTools
        .filter((tool) => tool.order !== 'pre')
        .map(normalize),
    );
  }

  if (options.length === 0) {
    return [];
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

function filterExtraSkills(
  extraSkills: ExtraSkill[] | undefined,
  templateName?: string,
  tools: string[] = [],
) {
  // `skill.when` only affects the interactive prompt. Explicit `--skill`
  // values are handled separately in `getSkills`.
  return extraSkills?.filter((extraSkill) => {
    const when = extraSkill.when ?? (() => true);
    return templateName ? when({ templateName, tools }) : true;
  });
}

function orderExtraSkills(extraSkills: ExtraSkill[] | undefined) {
  if (!extraSkills) {
    return [];
  }

  return [
    ...extraSkills.filter((extraSkill) => extraSkill.order === 'pre'),
    ...extraSkills.filter(
      (extraSkill) => typeof extraSkill.order === 'undefined',
    ),
    ...extraSkills.filter((extraSkill) => extraSkill.order === 'post'),
  ];
}

async function getSkills(
  { skill, dir, template }: Argv,
  extraSkills?: ExtraSkill[],
  templateName?: string,
  tools: string[] = [],
  promptMultiselect: typeof multiselect = multiselect,
) {
  const parsedSkills = parseSkillsOption(skill);
  const filteredExtraSkills = filterExtraSkills(
    extraSkills,
    templateName,
    tools,
  );

  if (parsedSkills !== null) {
    // Treat explicit `--skill` values as authoritative as long as they refer to
    // a declared skill. `skill.when` only hides options from the prompt.
    return parsedSkills.filter((value: string) =>
      extraSkills?.some((extraSkill) => extraSkill.value === value),
    );
  }

  if (dir && template) {
    return [];
  }

  if (!filteredExtraSkills?.length) {
    return [];
  }

  const orderedExtraSkills = orderExtraSkills(filteredExtraSkills);

  return checkCancel<string[]>(
    await promptMultiselect({
      message:
        'Select optional skills (Use <space> to select, <enter> to continue)',
      options: orderedExtraSkills.map((extraSkill) => ({
        value: extraSkill.value,
        label: extraSkill.label,
        hint: extraSkill.source,
      })),
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

export type RslintTemplateName =
  'vanilla-js' | 'vanilla-ts' | 'react-js' | 'react-ts';

const readJSON = async (path: string) =>
  JSON.parse(await fs.promises.readFile(path, 'utf-8'));

const readPackageJson = async (filePath: string) =>
  readJSON(path.join(filePath, 'package.json'));

const parseArgv = (processArgv: string[]) => {
  const argv = minimist<Argv>(processArgv.slice(2), {
    alias: { h: 'help', d: 'dir', t: 'template' },
    boolean: ['git'],
    default: { git: true },
  });

  // Set dir to first argument if not specified via `--dir`
  if (!argv.dir && argv._[0]) {
    argv.dir = argv._[0];
  }

  if (argv['package-name']) {
    argv.packageName = argv['package-name'];
  }

  // Handle template-version alias
  if (argv['template-version']) {
    argv.templateVersion = argv['template-version'];
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
    packageManager: string;
    distFolder: string;
    skipFiles: string[];
    addAgentsMdSearchDirs: (dir: string) => void;
  }) => unknown;
  /**
   * The custom command to run when the tool is selected.
   */
  command?: string;
  /**
   * Specify where to display this tool.
   * If undefined, the tool will be displayed after built-in tools.
   */
  order?: 'pre' | 'post';
  /**
   * Condition to determine whether this tool should be displayed.
   * If returns false, the tool will not be shown in the selection.
   * @default () => true
   */
  when?: (context: { templateName: string }) => boolean;
};

type ExtraSkill = {
  value: string;
  label: string;
  source: string;
  skill?: string;
  /**
   * Controls whether the skill is shown in the interactive prompt for the
   * selected template/tools. Explicit `--skill` values and `--help` remain
   * unfiltered so CLI input stays authoritative and help stays discoverable.
   */
  when?: (context: { templateName: string; tools: string[] }) => boolean;
  order?: 'pre' | 'post';
};

async function runCommand(
  command: string,
  cwd: string,
  packageManager: string,
) {
  command = replaceCreateCommand(command, packageManager);

  const result = await x(command, [], {
    nodeOptions: {
      shell: true,
      stdio: 'inherit',
      cwd,
    },
  });

  if (result.exitCode !== 0) {
    const details = [result.stderr, result.stdout]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(
      `Failed to run command: ${command}${details ? `\n${details}` : ''}`,
    );
  }
}

async function runSkillCommand(skills: ExtraSkill[], cwd: string) {
  const [firstSkill] = skills;
  // `skills add` accepts repeated `--skill` flags for a single source.
  const installArgs = skills.flatMap((skill) => [
    '--skill',
    skill.skill ?? skill.value,
  ]);
  const args = [
    '-y',
    'skills',
    'add',
    firstSkill.source,
    '--agent',
    'universal',
    '--yes',
    '--copy',
    ...installArgs,
  ];
  const command = `npx ${args.join(' ')}`;
  log.info(`Running skill install command: ${color.dim(command)}`);
  const skillLabel = skills.map((skill) => skill.value).join(', ');
  const skillNoun = skills.length === 1 ? 'skill' : 'skills';
  const installationTaskLog = taskLog({
    title: `Installing ${skillNoun} ${skillLabel}`,
  });

  const proc = x('npx', args, {
    nodeOptions: {
      cwd,
      stdio: 'pipe',
    },
  });

  for await (const line of proc) {
    installationTaskLog.message(line);
  }

  const result = await proc;

  if (result.exitCode !== 0) {
    const quotedSkillLabel = skills
      .map((skill) => `"${skill.value}"`)
      .join(', ');
    const message = `Failed to install ${skillNoun} ${quotedSkillLabel} from "${firstSkill.source}" using command: ${command}`;
    installationTaskLog.error(message);
    throw new Error(message);
  }

  installationTaskLog.success(`Installed ${skillNoun} ${skillLabel}`);
}

function detectGitRoot(cwd: string): boolean | null {
  try {
    const result = xSync(
      'git',
      ['rev-parse', '--is-inside-work-tree', '--show-prefix'],
      { nodeOptions: { cwd } },
    );

    if (result.exitCode !== 0) {
      return null;
    }

    const [insideWorkTree, prefix] = result.stdout.split(/\r?\n/u);
    return insideWorkTree === 'true' ? prefix === '' : null;
  } catch {
    return null;
  }
}

function initGit(cwd: string) {
  const currentIsGitRoot = detectGitRoot(cwd);
  if (currentIsGitRoot !== null) {
    // Reuse the current repository instead of creating a nested one.
    return currentIsGitRoot;
  }

  try {
    const result = xSync('git', ['init'], {
      nodeOptions: { cwd },
    });

    if (result.exitCode === 0) {
      log.success('Initialized Git repository');
      return true;
    }

    const details = result.stderr.trim();
    log.warn(
      `Failed to initialize Git repository.${details ? ` ${details}` : ''}`,
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to initialize Git repository. ${details}`);
  }

  return false;
}

async function resolveGit({
  gitEnabled,
  distFolder,
  templateName,
  onGitResolved,
}: {
  gitEnabled: boolean;
  distFolder: string;
  templateName: string;
  onGitResolved?: (context: GitResolvedContext) => void | Promise<void>;
}) {
  let projectIsGitRoot = false;

  if (gitEnabled) {
    projectIsGitRoot = initGit(distFolder);
  } else if (onGitResolved) {
    projectIsGitRoot = detectGitRoot(distFolder) ?? false;
  }

  if (onGitResolved) {
    await onGitResolved({
      templateName,
      distFolder,
      gitEnabled,
      isGitRoot: projectIsGitRoot,
    });
  }
}

function logNextStepsAndOutro(
  noteInformation: string[] | undefined,
  targetDir: string,
  packageManager: string,
) {
  const nextSteps = noteInformation
    ? noteInformation
    : [
        `1. ${color.cyan(`cd ${targetDir}`)}`,
        `2. ${color.cyan(`${packageManager} install`)}`,
        `3. ${color.cyan(`${packageManager} run dev`)}`,
      ];

  if (nextSteps.length) {
    note(nextSteps.map((step) => color.reset(step)).join('\n'), 'Next steps');
  }

  outro('All set, happy coding!');
}

export async function create({
  name,
  root,
  templates,
  skipFiles,
  getTemplateName,
  getPackageManager,
  mapESLintTemplate,
  mapRslintTemplate,
  version,
  noteInformation,
  git = true,
  onGitResolved,
  builtinTools,
  extraTools,
  extraSkills,
  argv: processArgv = process.argv,
}: {
  name: string;
  root: string;
  skipFiles?: string[];
  templates: string[];
  getTemplateName: (argv: Argv) => Promise<string>;
  /**
   * Specify the package manager for the selected template.
   * Return undefined to use the package manager detected from the user agent,
   * falling back to npm when no user agent is available.
   */
  getPackageManager?: (context: { templateName: string }) => string | undefined;
  /**
   * Map the template name to the ESLint template name.
   * If not provided, defaults to 'vanilla-ts' for all templates.
   */
  mapESLintTemplate?: (
    templateName: string,
    context: { distFolder: string },
  ) => ESLintTemplateName | null;
  /**
   * Map the template name to the Rslint template name.
   * If not provided, defaults to 'vanilla-ts' for all templates.
   */
  mapRslintTemplate?: (
    templateName: string,
    context: { distFolder: string },
  ) => RslintTemplateName | null;
  version?: Record<string, string> | string;
  noteInformation?: string[];
  /**
   * Whether to initialize a Git repository by default when the target directory
   * is not already inside one. Users can opt out with `--no-git`.
   *
   * @default true
   */
  git?: boolean;
  /**
   * Runs after template files are copied and the optional Git initialization
   * has been resolved.
   */
  onGitResolved?: (context: GitResolvedContext) => void | Promise<void>;
  /**
   * Controls which built-in tools are available.
   *
   * Omit this option to enable all built-in tools. Pass an empty array to
   * disable them, or list the built-in tools that should remain available.
   * Additional tools are configured separately with `extraTools`.
   *
   * @default BUILTIN_TOOLS
   */
  builtinTools?: BuiltinToolName[];
  /**
   * Specify additional tools.
   */
  extraTools?: ExtraTool[];
  extraSkills?: ExtraSkill[];
  /**
   * For test purpose, override the default argv (process.argv).
   */
  argv?: string[];
}) {
  const argv = parseArgv(processArgv);

  if (argv.help) {
    logHelpMessage(name, templates, git, builtinTools, extraTools, extraSkills);
    return;
  }

  logger.greet(`\n◆  Create ${upperFirst(name)} Project`);

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
  const detectedPackageManager = pkgInfo ? pkgInfo.name : 'npm';

  const { isAgent } = await determineAgent();
  if (isAgent) {
    console.log('');
    logger.info(
      `To create a project non-interactively, run: ${getAgentCreateCommand(name, detectedPackageManager)} <DIR> --template <TEMPLATE>`,
    );
  }

  const gitEnabled = git && argv.git !== false;

  const cwd = process.cwd();

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
          if (value?.length === 0) {
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
  const packageManager =
    getPackageManager?.({ templateName }) ?? detectedPackageManager;
  const templateParameters = { packageManager };

  const srcFolder = path.join(root, `template-${templateName}`);

  // Handle npm template: only when the local template doesn't exist
  // and the template input looks like an npm package
  if (
    typeof argv.template === 'string' &&
    isNpmTemplate(argv.template) &&
    !fs.existsSync(srcFolder)
  ) {
    const templateVersion = argv.templateVersion ?? argv['template-version'];
    const templatePath = resolveCustomTemplate(argv.template, templateVersion, {
      cacheDir: root,
    });

    // Copy npm template directly to distFolder
    copyFolder({
      from: templatePath,
      to: distFolder,
      version,
      packageName,
      templateParameters,
      skipFiles,
    });

    await resolveGit({
      gitEnabled,
      distFolder,
      templateName,
      onGitResolved,
    });

    logNextStepsAndOutro(noteInformation, targetDir, packageManager);
    return;
  }

  const localSkipFiles = [
    ...(skipFiles ?? []),
    ...getPackageManagerSkipFiles(packageManager),
  ];

  const tools = await getTools(argv, builtinTools, extraTools, templateName);
  const skills = await getSkills(
    argv,
    extraSkills,
    templateName,
    tools,
    multiselect,
  );

  const commonFolder = path.join(root, 'template-common');

  if (!fs.existsSync(srcFolder)) {
    throw new Error(`Invalid input: template "${templateName}" not found.`);
  }

  copyFolder({
    from: commonFolder,
    to: distFolder,
    version,
    skipFiles: localSkipFiles,
    templateParameters,
  });
  copyFolder({
    from: srcFolder,
    to: distFolder,
    version,
    packageName,
    templateParameters,
    skipFiles: localSkipFiles,
  });

  await resolveGit({
    gitEnabled,
    distFolder,
    templateName,
    onGitResolved,
  });

  const skillsByValue = new Map(
    (extraSkills ?? []).map((extraSkill) => [extraSkill.value, extraSkill]),
  );
  let currentSkillBatch: ExtraSkill[] = [];

  // Batch only contiguous skills from the same source to preserve install order.
  for (const skillValue of skills) {
    const matchedSkill = skillsByValue.get(skillValue);
    if (!matchedSkill) {
      continue;
    }

    if (
      currentSkillBatch.length > 0 &&
      currentSkillBatch[0].source !== matchedSkill.source
    ) {
      await runSkillCommand(currentSkillBatch, distFolder);
      currentSkillBatch = [];
    }

    currentSkillBatch.push(matchedSkill);
  }

  if (currentSkillBatch.length > 0) {
    await runSkillCommand(currentSkillBatch, distFolder);
  }

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
            packageManager,
            distFolder,
            skipFiles: [...localSkipFiles],
            addAgentsMdSearchDirs: (dir: string) =>
              agentsMdSearchDirs.push(dir),
          });
        }
        if (matchedTool.command) {
          await runCommand(matchedTool.command, distFolder, packageManager);
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
        skipFiles: localSkipFiles,
        templateParameters,
        isMergePackageJson: true,
      });

      agentsMdSearchDirs.push(toolFolder);
      agentsMdSearchDirs.push(subFolder);
      continue;
    }

    if (tool === 'rslint') {
      const rslintTemplateName = mapRslintTemplate
        ? mapRslintTemplate(templateName, { distFolder })
        : 'vanilla-ts';

      if (!rslintTemplateName) {
        continue;
      }

      const subFolder = path.join(toolFolder, rslintTemplateName);
      copyFolder({
        from: subFolder,
        to: distFolder,
        version,
        skipFiles: localSkipFiles,
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
      skipFiles: localSkipFiles,
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

  logNextStepsAndOutro(noteInformation, targetDir, packageManager);
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
    for (let i = 0; i < section.contents.length; i++) {
      const content = section.contents[i];
      const nextContent = section.contents[i + 1];

      result.push(content);

      if (nextContent) {
        const lastNewLineIndex = content.lastIndexOf('\n');
        const lastLine =
          lastNewLineIndex === -1
            ? content
            : content.substring(lastNewLineIndex + 1);

        const firstNewLineIndex = nextContent.indexOf('\n');
        const nextFirstLine =
          firstNewLineIndex === -1
            ? nextContent
            : nextContent.substring(0, firstNewLineIndex);

        // If both blocks are part of an unordered list (starting with '- '),
        // skip the newline to merge them.
        if (lastLine.startsWith('- ') && nextFirstLine.startsWith('- ')) {
          continue;
        }
      }

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
