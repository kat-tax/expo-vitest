# Explore

`expo-harness explore` runs the agent with a goal instead of a test: it
looks for what is wrong and reports it, an issue or a warning, each with the
steps that reach it.

```sh
npx expo-harness explore "Explore the checkout like a first-time buyer, and report anything off" --platform web
```

## A goal

Name where to look, a posture, and what counts as off: "send the sign-up
form with each field empty in turn", "change the quantity to 0, -1 and 999
and watch the total", "reload on every step of the checkout". A goal with
no posture explores at random.

| Option | What it is | Default |
| --- | --- | --- |
| `--platform` | Where to explore. | the first this machine can drive |
| `--agent` | An agent from `harness.config.ts`. | `default` |
| `--max-steps` | The actions it may take, 1 to 12. | 8 |
| `--timeout` | How long, in ms, at most 900 000. | 600 000 |
| `--out` | The report's folder. | `.harness/explore/<time>` |

It exits 1 when it reported an issue, 2 when it could not explore, else 0.

## Reading the report

`report.md` puts the issues first. Each says what was expected, what the
screen showed, the steps, and the step it was reported after, with that
step's tree in `steps/` and its screenshot in `screenshots/`. Every step of
the run is in the table at the end, with the `screen.*` query that finds the
node it acted on in `report.json`. `transcript.txt` has the model's calls.

A finding is the model's claim. Before acting on one, read the tree it
cites: the claim must show there. Then write the steps as a device test and
see it fail; `bug-bash` does that for each issue.

More: `node_modules/expo-vitest/docs/coding-agents.md`.
