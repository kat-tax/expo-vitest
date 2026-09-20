---
paths:
  - "src/projects.ts"
  - "src/setup/**"
  - "src/native.ts"
  - "src/windows.ts"
  - "src/router.tsx"
  - "src/metro-compat.ts"
  - "src/forbid-modules.ts"
  - "src/windows-resolution.ts"
---

# The package itself

`expoProjects`, `nodeProject` and `deviceConfig` are what a consumer's config
calls; everything else here is what they are built from. A change to any of it
lands in someone else's test run, where a failure looks like their bug.

## It runs from source here and from `dist` installed

Node strips types from a `.ts` file outside `node_modules` and refuses to
inside it, and a Vitest config is loaded by Node. So:

- Relative imports carry the `.ts` extension. The build rewrites them to `.js`,
  and `prepack` runs the build.
- No enums, no parameter properties, no namespaces: type stripping cannot erase
  them.
- **`file()` in `src/projects.ts` is how the package finds its own files**,
  `.ts` from source and `.js` compiled. A new setup file or subpath goes through
  it. A new subpath goes in `SUBPATHS` and in `package.json`'s `exports`, and a
  test fails when the two disagree.

## What the projects must keep doing

- **Alias the package's subpaths to absolute files**, or a test and a setup file
  can load two copies of a helper.
- **Keep `node_modules/expo-vitest/` in the Vite graph**, or a setup file's
  `vi.mock` is not hoisted. The pattern is anchored on `node_modules` because a
  checkout is a folder called `expo-vitest` too.
- **Exclude this package from the React Native transform.** The engine compiles
  any dependency named `expo-*` as React Native source, which puts Babel helpers
  above a hoisted `vi.mock`. That is also why `src/setup/native.ts` has no
  `async` in it.
- **Set Vite's `root` and Vitest's `test.root`.** vitest-native reads the first;
  where they differ the engine resolves packages from one folder for code that
  lives in another.
- **Let the web project serve what it resolves.** Vite serves only under its
  workspace root, so a hoisted or linked install above a project needs
  `server.fs.allow` (`installFolders`).
- Projects do not inherit the root `test` block, so each carries its own
  globals, mock clearing and timeout. Coverage and reporters stay the
  consumer's.

## Verifying a change here

The unit tests cover what is logic. A setup file, a Node require hook and a
plugin are only proved by `bun run test:fixture`, which packs the package,
installs it into a copy of `fixture/` outside this folder and runs its tests by
name. A change to any of those is not done until that has run.
