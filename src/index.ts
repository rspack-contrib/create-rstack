import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
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
}: {
  name: string;
  root: string;
  skipFiles?: string[];
  templates: string[];
  getTemplateName: (argv: Argv) => Promise<string>;
  mapESLintTemplate: (templateName: string) => ESLintTemplateName | null;
  version?: Record<string, string> | string;
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
        placeholder: `${name}-project`,
        defaultValue: `${name}-project`,
        validate(value) {
          if (value.length === 0) {
            return 'Project name is required';
          }
        },
      }),
    );

  const { targetDir, packageName } = formatProjectName(projectName);
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
  for (const tool of tools) {
    const toolFolder = path.join(packageRoot, `template-${tool}`);

    if (tool === 'eslint') {
      const eslintTemplateName = mapESLintTemplate(templateName);

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

      continue;
    }

    copyFolder({
      from: toolFolder,
      to: distFolder,
      version,
      skipFiles,
      isMergePackageJson: true,
    });

    if (tool === 'biome') {
      const packageJson = await readPackageJson(distFolder);
      let biomeVersion: string =
        packageJson.devDependencies?.['@biomejs/biome'] ?? '1.9.4';

      biomeVersion = biomeVersion.replace(/\^/, '');

      const biomeJsonPath = path.join(distFolder, 'biome.json');
      const biomeJson = await readJSON(biomeJsonPath);

      biomeJson.$schema = biomeJson.$schema.replace('{version}', biomeVersion);

      await fs.promises.writeFile(
        biomeJsonPath,
        `${JSON.stringify(biomeJson, null, 2)}\n`,
        'utf-8',
      );
    }
  }

  const nextSteps = [
    `1. ${color.cyan(`cd ${targetDir}`)}`,
    `2. ${color.cyan('git init')} ${color.dim('(optional)')}`,
    `3. ${color.cyan(`${pkgManager} install`)}`,
    `4. ${color.cyan(`${pkgManager} run dev`)}`,
  ];

  note(nextSteps.map((step) => color.reset(step)).join('\n'), 'Next steps');

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
        updatePackageJson(distFile, version, packageName);
      }
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
