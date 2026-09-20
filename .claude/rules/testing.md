---
paths:
  - "src/**/*.test.ts"
  - "fixture/**"
  - "vitest.config.mts"
  - "scripts/**"
---

# Testing this package

Two runs, and they prove different things.

```sh
bun run test:coverage   # the logic, in Node
bun run test:fixture    # the packed package, installed, on all four projects
```

## The unit tests

One Node project (`nodeProject({name: 'expo-vitest', include: ['src/**/*.test.ts']})`).
The gate is 100% on all four metrics over the files that are logic:
`projects.ts`, `forbid-modules.ts`, `windows-resolution.ts` and `timeout.ts`.
Everything else is covered by the fixture, deliberately: a setup file, a require
hook or a driver proves nothing when called from Node.

## The fixture

`fixture/` is a library the size of one constant, with a file per platform and
one test for each rule a test file's name follows. Its manifest is what an app
that tests with this package has installed.

`scripts/fixture.js` copies it outside the package, installs it there from
`bun.lock`, packs this package as `npm publish` would, unpacks that into the
copy's `node_modules`, names it in the copy's manifest, and runs the tests by
name. It is the only thing that can catch what differs when installed:

- Node will not strip types under `node_modules`.
- Vitest leaves what is there out of its module graph unless told otherwise.
- The engine treats a dependency differently from the project it runs in, and
  compiles anything named `expo-*` as React Native source.

**The fixture cannot live inside the package folder.** The engine skips any
package whose folder contains the test run, taking it for the project itself, so
a fixture in place would never be treated as a consumer's dependency. Linking
the package in with a junction is wrong too: the engine then resolves two copies
of `expo-modules-core`.

After changing `fixture/package.json`:

```sh
node scripts/fixture.js --update-lockfile
```

## Writing a test here

- `vi.*` only; jest compatibility is off.
- A test that asserts on a config asserts on what a consumer would see: the
  project's name, its `include` and `exclude`, the plugins it carries. Reaching
  into a plugin's closure proves nothing about the run.
- A rehearsal that must fail first is worth keeping as a test: prove the guard
  by removing what it guards.
