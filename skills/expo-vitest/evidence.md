# Evidence

A failing device test leaves what it saw in
`.harness/results/<platform>/<test file>/<test>/`:

| File | What it holds |
| --- | --- |
| `trace.md` | The test, its failure, its steps, and the screen at the end. Read this first. |
| `screenshot.png` | The screen when the test ended. |
| `tree.txt` | The tree then, as `expo-harness tree` prints it. |
| `tree.json` | The same tree as JSON. |

## Reading the trace

The failure comes first: what was expected, how many times the tree was read,
and what was there instead, such as names like the one asked for.

Then each step, with when it ran, how long it took, how it ended, and what it
did to the screen: the nodes that appeared and went, and where the focus
moved. A step that changed nothing, before a step that failed, is usually the
cause. A `## Component` section names the React component behind the node the
failing step was after, and on web the page's console follows.

## What to do with it

- A query that matched nothing: the trace lists names like the one asked for,
  and `tree.txt` has every node. Use the name the tree shows.
- A locator that matched several: the message lists them. Narrow it with
  `.first()`, `.nth(i)` or `.filter({hasText})`, or a role with a name.
- A screenshot that differs: `.harness/<platform>-<name>.expected.png`,
  `.actual.png` and `.diff.png` are side by side, the changed pixels red in
  the diff.

## When it is written

`HARNESS_TRACE` decides: `retain-on-failure`, the default, keeps a failed
test's folder; `on` keeps every test's; `off` keeps none. A folder is
replaced each time its test runs. Nothing under `.harness/` is for
committing, and a baseline is never recorded by a run on its own.

More: `node_modules/expo-vitest/docs/evidence.md`.
