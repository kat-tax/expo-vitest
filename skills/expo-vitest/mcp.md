# The MCP server

`expo-harness mcp` lets a coding agent drive the running app over MCP, with
the agent's own tools and rules, to find a flow before writing its device
test. `npx expo-vitest init --mcp` registers it where Claude Code and Cursor
read a project's servers:

```json
{"mcpServers": {"expo-harness": {"type": "stdio", "command": "npx", "args": ["expo-harness", "mcp"]}}}
```

That is `.mcp.json` for Claude Code, which asks before it first starts a
project's server, and `.cursor/mcp.json` for Cursor.

## The loop

1. `open_session`, with a `target` platform where the server was started with
   none. It answers the session's id, its tools and the first observation.
2. `tools`, for the tools and their input schemas.
3. `call` with `tool: "observe"`, then act with `tap`, `type`, `check` and the
   rest, each by a node's ref, such as `@e7`.
4. Read what changed in each answer before the next action.
5. `call` with `tool: "locate"`, giving one of `role`, `text`, `label`,
   `placeholder` or `testId`, and `name` with a role. It answers the matches
   and the `screen.*` call that finds one alone: that call goes in the test.
6. `close_session` when done.

`tools` and `tools/list` are two things: `tools/list` names the server's four
tools, `tools` lists a session's own.

## Rules

- A ref names the same node for the whole session. A node that has gone is
  `NODE_STALE`: observe again.
- A secret from the harness config is filled with `type_secret` by its name.
  Its value never comes back, and after one is filled, `screenshot` and
  `tap_at` answer `PIXEL_TAINTED` for the rest of the session.
- Open one session for each subagent. With several open, each call names its
  `session`; without one it is `SESSION_REQUIRED`.
- All open sessions share one harness config: another is `CONFIG_IN_USE`.
- Web gives each session a browser of its own. Windows, Android and iOS take
  one session each at a time: one desktop, one device. Synthetic input on
  Windows waits until the machine has been quiet for three minutes, unless
  the session was opened with `force: true` or the server with `--force`.
- An open that takes more than three minutes answers `OPEN_TIMEOUT`; run
  `npx expo-harness doctor` to see what the machine can drive.
- A session ends at `close_session`, after 30 idle minutes, after 4 hours, and
  when the client goes.

## Options

`--platform <name>`, `--config <path>`, `--headed` on web, `--force` on
Windows, `--max-sessions <n>` (1 to 16, 4 by default).

More: `node_modules/expo-vitest/docs/coding-agents.md`.
