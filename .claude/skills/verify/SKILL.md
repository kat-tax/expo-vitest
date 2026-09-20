---
name: verify
description: "Run this package's check loop: lint, typecheck, the unit tests with the 100% gate, and the fixture that runs the packed package as an app installs it. Use before reporting any work done, and to find what a failing coverage run is missing."
allowed-tools: [Bash(bun run *), Bash(node node_modules/*), Read, Grep]
---

# Verify

The whole loop, in the order that fails fastest:

```sh
bun run lint            # oxlint, zero warnings
bun run typecheck       # tsc
bun run test:coverage   # the logic, in Node, with the gate
bun run test:fixture    # the packed package, installed, on all four projects
```

All four must pass before work is reported done. If one fails, fix it and run
that one again rather than the whole loop.

The first three take seconds. The fixture packs, installs and runs four
platform projects, so it takes a few minutes: run it in the background and keep
working.

## What each one can catch

The unit tests cover what is logic, and the gate is 100% on `projects.ts`,
`forbid-modules.ts`, `windows-resolution.ts` and `timeout.ts`.

**A setup file, a Node require hook, a Vite plugin or a driver is not covered
by them at all.** Those are proved by the fixture, which is the only run where
this package is a dependency in `node_modules` rather than the project itself.
A change to any of them is not done until the fixture has run.

## Narrowing while iterating

```sh
node node_modules/oxlint/bin/oxlint --max-warnings 0 src/harness
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/projects.test.ts
```

## Coverage

The text table rounds and will not tell you where the hole is:

```sh
awk '/^SF:/{f=$0} /^DA:/{split($0,a,","); if(a[2]=="0") print f, $0} /^BRDA:/{split($0,a,","); if(a[4]=="0"||a[4]=="-") print f, $0}' coverage/lcov.info
```

`SF:` is the file, `DA:<line>,0` an uncovered line, `BRDA:<line>,<block>,<branch>,0`
an uncovered branch. Cover it with a test that means something; if the branch is
genuinely unreachable, delete it rather than test it.

## Against a consumer

A change to how the projects are made can pass everything here and still break
a repository that uses it. `expo-interface` and `expo-windows` are the two,
and both hold 100% coverage:

```sh
cd ../expo-interface && bun run test
cd ../expo-windows && bun run test
```

Install this package from a checkout the way the fixture does, never with a
junction: the engine then resolves two copies of `expo-modules-core`.
