# Contributing

[Docs home](README.md)

## The repository

| Path | What |
| --- | --- |
| `src/projects.ts` | `expoProjects`, `nodeProject` and `deviceConfig`. |
| `src/forbid-modules.ts`, `src/windows-resolution.ts`, `src/metro-compat.ts` | The Vite plugins the projects are made of. |
| `src/setup/` | Each project's setup file. |
| `src/native.ts`, `src/windows.ts`, `src/router.tsx` | The helpers. |
| `src/device/` | The device test API and its matchers. |
| `src/harness/` | The drivers and the `expo-harness` command. |
| `fixture/` | A library the size of one constant, tested against the packed package. |
| `scripts/` | The build and the fixture run. |

`AGENTS.md` at the root has the conventions.

## Checks

```sh
bun install             # bun 1.4 or later
bun run lint            # oxlint, zero warnings
bun run typecheck
bun run test:coverage   # 100% on the files the gate names
bun run test:fixture    # the package, packed and installed
```

## It runs from source here, and from `dist` installed

The package runs from its TypeScript source in this repository, which Node
allows outside `node_modules`. Node will not strip types under `node_modules`,
so installed it has to be JavaScript. `prepack` compiles `src` to `dist`, and
the `exports` map points there.

Inside the package, a file is named through `file()` in `src/projects.ts`,
which answers the `.ts` from source and the `.js` when compiled.

## The fixture

`fixture/` is a library the size of one constant, with a file per platform and
one test for each rule a test file's name follows. Its manifest is what an app
that tests with `expo-vitest` has installed.

```sh
bun run test:fixture
```

This copies the fixture to a folder outside the package, installs it there
from `bun.lock`, packs the package as `npm publish` would, unpacks that into
the copy's `node_modules`, names it in the copy's manifest, and runs the tests
against it by name.

It is how the package is known to work installed, which its source cannot
say. Three things differ for an installed package:

- Node will not strip types under `node_modules`.
- Vitest leaves what is there out of its module graph unless told otherwise.
- The engine treats a dependency differently from the project it runs in. It
  compiles any dependency named `expo-*` as React Native source, which is why
  the projects exclude `expo-vitest` from that transform.

The fixture has to be copied out because the engine skips any package whose
folder contains the test run, taking it for the project itself. A fixture
inside the package folder is never treated as a consumer's dependency.

After changing `fixture/package.json`:

```sh
node scripts/fixture.js --update-lockfile
```

## CI

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | Pushes to `master` and pull requests | Lint, typecheck, the tests with coverage, the fixture. |
| `release.yml` | A `v*` tag matching `package.json` | Re-runs the checks, publishes to npm with provenance, creates a GitHub release. |

## Commits and writing

One change per commit, with a message that says why the change was needed and
what was verified. Plain sentences, no em dashes.
