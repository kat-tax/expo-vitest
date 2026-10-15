# Bug bash

`expo-harness bug-bash` explores many charters at once, merges what they
find, writes a skeleton test for each issue, and runs the skeletons. An issue
counts as a bug only when its skeleton fails its check.

```sh
npx expo-harness bug-bash --feature-map device/features.json --platform web --parallel 4
```

## The feature map

```json
{
  "areas": [
    {"name": "checkout", "goals": ["buy one item as a first-time user", "enter edge values in every quantity field"], "agent": "buyer"},
    {"name": "settings"}
  ],
  "postures": ["first-time user", "numbers and copy", "edge input", "state after reload", "error paths"]
}
```

Each goal is a charter. An area with no goals gets one charter per posture:
the map's, or those five. `name` names files, so it is lower case. `agent`
picks an agent from `harness.config.ts`. Web runs `--parallel` charters at
once; Windows, Android and iOS run one at a time.

## What it leaves

- `.harness/bug-bash/<time>/report.md`: confirmed bugs, then risks it could
  not verify, then rejected findings, then warnings, then each charter with
  its cost. Each charter's own explore report is in `<area>-<n>/`.
- `findings.json`: the findings merged. Two are one when they share a route
  and a title, or their first three steps, and the one kept names the other.
- `device/bug-bash/<area>-<slug>.test.ts` for each issue: the explore's steps
  by their queries, then `agent.assert` of what was expected, inside
  `describe.skipIf(!process.env.HARNESS_BUGBASH)`.

A skeleton whose check failed with `ASSERTION_FAILED` is a bug. One that
passed is rejected: the app did what was expected. One that failed before
its check is a risk to look at by hand. It exits 1 on a bug, or on an issue
whose skeleton did not run.

## Promoting a skeleton

Review its steps and its expectation. Replace `agent.assert` with a matcher
where one says the same. Fix the bug, take the `describe.skipIf` off, and
move the file out of `device/bug-bash/`: it is a regression test now. Run
the skeletons again with:

```sh
HARNESS_BUGBASH=1 npx vitest run --config vitest.config.device.mts device/bug-bash
```

More: `node_modules/expo-vitest/docs/coding-agents.md`.
