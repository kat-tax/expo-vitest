# Coding agents

[Docs home](README.md) · [The harness](harness.md) · [Evidence](evidence.md)

A coding agent writing tests here needs what a person learns from these
pages: which project runs a file, how a device test finds and acts on a
node, and where a failure leaves its evidence. The package ships that as a
skill, in `skills/expo-vitest/`: `SKILL.md`, the overview, and a page each on
the projects, the device, the evidence and the harness.

## The guide

```sh
npx expo-vitest guide            # the overview
npx expo-vitest guide device     # one topic
npx expo-vitest guide --list     # the topics
```

`guide` prints the skill from the copy of the package that is installed, so
what an agent reads is always the version the project runs. Any agent that
can run a command can read it. One line in `AGENTS.md`, or `CLAUDE.md`,
points it there:

```
Tests use expo-vitest. Run `npx expo-vitest guide` for how to write them, run them and read a failure.
```

`init` prints this line and leaves the file to you.

## The skill in a project

`init` asks whether to add the skill, and copies it into
`.claude/skills/expo-vitest/`, where Claude Code reads a project's skills. Run
again after an upgrade, it replaces a file whose `metadata.version` is older
than the package's, showing the change first, and leaves one that was edited
since it was copied. The skill may run `vitest`, `expo-harness` and
`expo-vitest` through `npx` or `bunx`, and read and search files.

## What the evidence gives an agent

A failing device test leaves `trace.md` in its [folder](evidence.md): what was
expected, what was there instead, such as names like the one asked for, and
each step with what it did to the screen. It is text written to be read
before anything else, so an agent fixes the query, the wait or the app from
it without a screenshot. `tree.txt` has every node, and the skill's evidence
page says what to do with each kind of failure.

## Not yet

An MCP server, so an agent drives a device through tools as well as by
command, is [planned](https://github.com/kat-tax/expo-vitest/blob/master/plan/phase-6-agent-surfaces.md).
