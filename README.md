# @rstackjs/create-toolkit

A shared package for create-rspack, create-rsbuild, create-rslib and more.

> This package should only be used in Rstack projects.

> [!NOTE]
> This package was renamed from `create-rstack` to `@rstackjs/create-toolkit`.
> Update your dependencies and imports to use the new package name.

<p>
  <a href="https://npmjs.com/package/@rstackjs/create-toolkit">
   <img src="https://img.shields.io/npm/v/@rstackjs/create-toolkit?style=flat-square&colorA=564341&colorB=EDED91" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&colorA=564341&colorB=EDED91" alt="license" />
</p>

## Install

```bash
npm add @rstackjs/create-toolkit -D
```

## Features

### Configure Built-in Tools

The toolkit provides ESLint, Rslint, Biome, and Prettier as built-in tools. Use
`builtinTools` to control which of them are available without affecting tools
added through `extraTools`:

```ts
create({
  // Disable all built-in tools.
  builtinTools: [],
  // Custom tools remain available.
  extraTools: [{ value: 'custom-tool', label: 'Custom Tool' }],
  // ...other options
});
```

Omit the option to enable every built-in tool. Pass an array such as
`['rslint', 'prettier']` to enable only those tools.

### Package Manager Configuration

Use `getPackageManager` to specify a package manager for a template:

```ts
create({
  getPackageManager: ({ templateName }) =>
    templateName === 'turborepo' ? 'pnpm' : undefined,
  // ...other options
});
```

Return `undefined` to use the package manager detected from the user agent, falling back to npm.

When a local template contains `pnpm-workspace.yaml`, the file is only copied if the resolved package manager is pnpm. Templates loaded from third-party npm packages are copied without this filtering.

The toolkit automatically passes the resolved `skipFiles` list to custom `extraTools` actions. When an action uses `copyFolder` to copy a local tool template, forward the received list so the same package-manager filtering is applied:

```ts
import { copyFolder, create } from '@rstackjs/create-toolkit';

create({
  extraTools: [
    {
      value: 'storybook',
      label: 'Storybook',
      action: ({ distFolder, skipFiles }) => {
        copyFolder({
          from: storybookTemplate,
          to: distFolder,
          skipFiles,
          isMergePackageJson: true,
        });
      },
    },
  ],
  // ...other options
});
```

### Git Initialization

By default, the toolkit initializes a Git repository after creating the
project. If the target directory is already inside a Git worktree, the existing
repository is reused to avoid creating a nested repository.

Set `git` to `false` to disable Git initialization:

```ts
create({
  git: false,
  // ...other options
});
```

Use `onGitResolved` to run project-specific setup after template files are
copied and Git initialization has been resolved:

```ts
create({
  onGitResolved: async ({ distFolder, gitEnabled, isGitRoot }) => {
    if (gitEnabled && isGitRoot) {
      // Add files that should only exist at the Git repository root.
    }
  },
  // ...other options
});
```

The callback runs for both enabled and disabled Git initialization. `isGitRoot`
indicates whether the generated project directory is the root of its Git
worktree.

### NPM Template Support

`@rstackjs/create-toolkit` supports using npm packages as templates, allowing users to create projects from custom templates published to npm.

#### Usage

```bash
# Using npm package name
npm create rsbuild@latest my-project -- --template my-template-package

# Using scoped package
npm create rsbuild@latest my-project -- --template @scope/template-package

# Using explicit npm: prefix
npm create rsbuild@latest my-project -- --template npm:my-template-package

# With specific version
npm create rsbuild@latest my-project -- --template my-template-package --template-version 1.2.3
```

#### Template Package Structure

Your npm template package should have one of the following structures:

```
my-template-package/
├── template/              # Preferred
│   ├── package.json
│   └── src/
├── templates/
│   └── app/              # Alternative
└── (root)                # Fallback
    ├── package.json
    └── src/
```

#### Caching Strategy

- Templates with `latest` version are always re-installed to ensure the latest version
- Specific versions are cached in `.temp-templates/` for faster reuse

#### API

```typescript
import {
  isNpmTemplate,
  resolveCustomTemplate,
  resolveNpmTemplate,
} from '@rstackjs/create-toolkit';

// Check if template input is an npm package
if (isNpmTemplate(templateInput)) {
  // Resolve npm template to local path
  const templatePath = resolveCustomTemplate(templateInput, version);
}
```

## Examples

| Project | Link                                                                                         |
| ------- | -------------------------------------------------------------------------------------------- |
| Rsbuild | [create-rsbuild](https://github.com/web-infra-dev/rsbuild/tree/main/packages/create-rsbuild) |
| Rslib   | [create-rslib](https://github.com/web-infra-dev/rslib/tree/main/packages/create-rslib)       |

![image](https://github.com/user-attachments/assets/2dda3501-720c-4151-bd3e-5e038dca9e68)

## License

[MIT](./LICENSE).
