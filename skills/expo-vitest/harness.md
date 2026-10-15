# The harness

`expo-harness` drives the same app the device tests drive, from a terminal,
for looking at a screen by hand.

```sh
npx expo-harness doctor
npx expo-harness -p web --url http://localhost:8081 open / tree
npx expo-harness -p android --scheme myapp open /settings press "Save" screenshot after.png
```

`doctor` says what this machine can drive, and what is missing where it
cannot.

## Steps

| Step | What it does |
| --- | --- |
| `open <path or url>` | A route, as a deep link or a URL. |
| `snapshot [file]` | The accessibility tree as JSON. |
| `tree` | The same, as indented text. |
| `press <target>` | A press on what a ref or a selector names. |
| `tap <x> <y>` | A press at a point. |
| `fill <target> <text>` | Puts text in a field, in place of what it held. |
| `type <text>` | Types into whatever has the focus. |
| `screenshot <file>` | A PNG, under `.harness/` unless the path says otherwise. |
| `raise` | Brings the app to the front, on the desktop. |
| `wait <ms>` | Lets something settle. |
| `idle` | How long the machine has been quiet. |
| `bench [n]` | Times each operation n times. |

## Targets

`@e7`, a ref from the last snapshot; `label="Save"`; `role=button`; or a bare
word, which is a label.

## Options

`--platform` or `-p`, `--url`, `--scheme`, `--target`, `--out`, `--interactive`,
`--force`, `--settle <ms>`, `--transition <ms>`.

On Windows, synthetic input waits until nobody has used the machine for three
minutes, since it goes to whatever window is in front; `--force` sends it
anyway.

More: `node_modules/expo-vitest/docs/harness.md`.
