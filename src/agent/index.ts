/**
 * `expo-vitest/agent`: steps written in words, carried out by a model on
 * the same device the test file's scripted steps use, with the same
 * journal, so the evidence of a failing test shows both in order.
 *
 *   import {agent, secret} from 'expo-vitest/agent';
 *
 *   await agent.act('sign in as {user} with {password}', {params: {user: 'ada', password: secret('ADA_PASSWORD')}});
 *   await agent.assert('the dashboard shows the workspace name');
 *
 * The agents, their models and the secrets come from `harness.config.ts`,
 * which the device project's setup file loads in the worker.
 */
import path from 'node:path';
import type {TestContext} from 'vitest';
import {afterEach, beforeEach, describe} from 'vitest';
import {currentHarness, currentRun} from '../device/config.ts';
import {device} from '../device/index.ts';
import type {AgentHost, TestOf} from './runtime.ts';
import {AgentRuntime} from './runtime.ts';
import type {ActOptions, ActResult, AssertOptions, ExtractOptions, Infer, JsonSchema, StandardSchemaV1, WaitForOptions} from './types.ts';

export type {AgentConfig, HarnessAgents} from './config.ts';
export type {Budget, CompletedStep, Observation, StepContext, StepOutcome} from './context.ts';
export type {StepExecutor, ToolHelpers, ToolLoopOptions} from './executors.ts';
export {toolLoopExecutor} from './executors.ts';
export {isSecret, isUnique, secret, unique} from './secrets.ts';
export type {Tool, ToolContext, ToolDefinition} from './tools.ts';
export {defineTool} from './tools.ts';
export type {
  ActOptions,
  ActResult,
  AgentErrorCode,
  AgentStepKind,
  AssertOptions,
  BlockedCode,
  Completion,
  CompletionRequest,
  ExtractOptions,
  ImagePart,
  Infer,
  JsonSchema,
  Message,
  Model,
  ReplayHandOffReason,
  ReplayMissReason,
  Secret,
  StandardSchemaV1,
  StepCacheInfo,
  SystemBlock,
  TextPart,
  ToolResultPart,
  ToolSpec,
  ToolUsePart,
  Unique,
  Usage,
  VisionMode,
  WaitForOptions,
} from './types.ts';
export {AGENT_CODES, AgentError, BLOCKED_CODES, isAgentError} from './types.ts';

/** The four calls, on the agent a step names, the nearest forEachAgent's, or default. */
export interface Agent {
  act(instruction: string, options?: ActOptions): Promise<ActResult>;
  assert(assertion: string, options?: AssertOptions): Promise<void>;
  waitFor(condition: string, options?: WaitForOptions): Promise<void>;
  extract<S extends StandardSchemaV1 | JsonSchema>(instruction: string, options: ExtractOptions<S>): Promise<Infer<S>>;
  /** The same calls, on the agent named, wherever they are called. */
  as(name: string): Agent;
}

/** The project under test: where the tests are run from, unless `HARNESS_ROOT` names it. */
const ROOT = path.resolve(process.env.HARNESS_ROOT ?? process.cwd());

/** The test running now, as its `beforeEach` saw it. */
let running: TestContext | undefined;
/** The agents of the forEachAgent blocks around the test running now, innermost last. */
const selected: string[] = [];
let made: AgentRuntime | undefined;

/** The device the test file shares, as the runtime acts through it. */
const host: AgentHost = {
  get platform() {
    return device.platform;
  },
  ready: () => device.ready(),
  snapshot: () => device.feed.next(),
  // Where the app is, on web; a device's screen has no route to read.
  route: async () => (device.platform === 'web' ? ((await device.ready()).web?.evaluate<string>('location.pathname + location.search') ?? undefined) : undefined),
  get journal() {
    return device.journal;
  },
  get capabilities() {
    return device.capabilities as ReadonlySet<string>;
  },
  scratch: path.join(ROOT, '.harness', 'agent'),
  get scheme() {
    return device.config.scheme;
  },
  get identity() {
    return currentRun()?.identity ?? device.config.url ?? device.platform;
  },
  get url() {
    return device.config.url;
  },
  root: ROOT,
};

/** The test running now, for the cache's key and the step's signal. */
function testNow(): TestOf {
  const task = running?.task;
  if (!task) return {file: '', titlePath: [], retry: 0};
  const titlePath = [task.name];
  for (let suite = task.suite; suite?.name; suite = suite.suite) titlePath.unshift(suite.name);
  return {file: path.relative(ROOT, task.file.filepath).replace(/\\/g, '/'), titlePath, retry: task.result?.retryCount ?? 0, signal: (running as TestContext).signal};
}

/** The runtime, made at its first use, which is after the setup file has loaded the harness config. */
function runtime(): AgentRuntime {
  made ??= new AgentRuntime({host, harness: currentHarness() ?? null, test: testNow});
  return made;
}

beforeEach(context => {
  running = context;
  runtime().begin();
});

afterEach(() => {
  runtime().end();
  running = undefined;
});

function bound(name?: string): Agent {
  const named = () => name ?? selected.at(-1);
  return {
    act: (instruction, options) => runtime().act(instruction, options, named()),
    assert: (assertion, options) => runtime().assert(assertion, options, named()),
    waitFor: (condition, options) => runtime().waitFor(condition, options, named()),
    extract: (instruction, options) => runtime().extract(instruction, options, named()),
    as: other => bound(other),
  };
}

/** The agent: `agent.act`, `agent.assert`, `agent.waitFor` and `agent.extract`, and `agent.as(name)` for another. */
export const agent: Agent = bound();

/**
 * A block of tests run once for each agent named, its name in brackets in
 * the titles, each step in it run by that agent unless the step names
 * another. The cache keys on the agent, so one never replays another's.
 */
export function forEachAgent(names: readonly string[], suite: (name: string) => void): void {
  describe.each([...names])('[%s]', name => {
    beforeEach(() => void selected.push(name));
    afterEach(() => void selected.pop());
    suite(name);
  });
}
