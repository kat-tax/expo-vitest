/**
 * Who runs a step: the built-in loop, or a project's own executor. Every
 * executor gets the same step context, so a custom one acts through the
 * same authorised, counted and recorded actions as the built-in loop does,
 * and cannot go around the policy.
 */
import {isHarnessError} from '../harness/lib/errors.ts';
import type {StepContext, StepOutcome} from './context.ts';
import {CORE_PROMPT, firstTurn, grammarLoopTools, projectTool, runLoop} from './loop.ts';
import type {StepOf} from './step.ts';
import type {Tool} from './tools.ts';
import type {CompletionRequest, Message, SystemBlock} from './types.ts';
import {AgentError, isBlockedCode} from './types.ts';

export interface StepExecutor {
  /** Its name and version, which the cache key holds, so one executor never replays another's steps. */
  name: string;
  version: string;
  /** `off` keeps its steps out of the cache. */
  cache?: 'inherit' | 'off';
  runStep(ctx: StepContext): Promise<StepOutcome>;
}

/** The built-in loop's version, in the cache key: what changes what it records changes this. */
export const BUILTIN_VERSION = '1';

/** An act's system blocks: the frozen prompt first, then the agent's context and instructions, where the cache's breakpoint goes. */
export function actingSystem(prompt: string, agentContext: string, system?: string): SystemBlock[] {
  const own = [agentContext && `About the app:\n${agentContext}`, system && `Instructions for this agent:\n${system}`].filter(Boolean).join('\n\n');
  return [{text: prompt}, {text: own || 'About the app: nothing more is known.', cache: true}];
}

export interface BuiltinOptions {
  /** The agent's own instructions, which the acting loop alone reads. */
  system?: string;
  /** The project's tools, for the step's platform. */
  tools?: readonly Tool[];
  effort?: CompletionRequest['effort'];
  maxTokens?: number;
}

/** The built-in loop as an executor, so the runner has one path for every step. */
export function builtinExecutor(options: BuiltinOptions = {}): StepExecutor {
  return {
    name: 'builtin',
    version: BUILTIN_VERSION,
    async runStep(ctx) {
      const first = await ctx.observe();
      return runLoop(ctx, {
        system: actingSystem(CORE_PROMPT, ctx.agentContext, options.system),
        prompt: [firstTurn(ctx, first.text)],
        tools: [...grammarLoopTools(ctx), ...(options.tools ?? []).map(tool => projectTool(ctx, tool))],
        ...(options.effort ? {effort: options.effort} : {}),
        ...(options.maxTokens ? {maxTokens: options.maxTokens} : {}),
      });
    },
  };
}

/** What a tool-loop executor's tools are given: `guard` makes a harness failure the tool's answer, rather than the step's end. */
export interface ToolHelpers {
  guard<T>(run: () => Promise<T>): Promise<T | string>;
}

export interface ToolLoopOptions {
  name: string;
  version?: string;
  /** Its own frozen prompt, in place of the built-in one. */
  system: string;
  /** The first turn: its text, or the turns themselves. */
  buildPrompt(ctx: StepContext): string | readonly Message[] | Promise<string | readonly Message[]>;
  /** Its tools; complete_step is the loop's own. */
  tools(ctx: StepContext, helpers: ToolHelpers): Record<string, Tool>;
  /** The messages to send for a call, from the history as it stands. */
  prepareMessages?(messages: readonly Message[], ctx: StepContext): readonly Message[];
  /** Model calls, which may only lower the step's own budget. */
  maxModelCalls?: number;
  effort?: CompletionRequest['effort'];
}

const guard: ToolHelpers['guard'] = run => run().catch((error: unknown) => (isHarnessError(error) ? `${error.code}: ${error.message}` : Promise.reject(error)));

/** An executor that runs the built-in loop with a prompt and tools of its own. */
export function toolLoopExecutor(options: ToolLoopOptions): StepExecutor {
  const {prepareMessages} = options;
  return {
    name: options.name,
    version: options.version ?? '1',
    async runStep(ctx) {
      const prompt = await options.buildPrompt(ctx);
      return runLoop(ctx, {
        system: actingSystem(options.system, ctx.agentContext),
        prompt: typeof prompt === 'string' ? [{role: 'user', content: [{type: 'text', text: prompt}]}] : prompt,
        tools: Object.values(options.tools(ctx, {guard})).map(tool => projectTool(ctx, tool)),
        ...(prepareMessages ? {prepareMessages: (messages: readonly Message[]) => prepareMessages(messages, ctx)} : {}),
        ...(options.maxModelCalls ? {maxModelCalls: options.maxModelCalls} : {}),
        ...(options.effort ? {effort: options.effort} : {}),
      });
    },
  };
}

/**
 * The error a step that did not pass ends with: a failure with its code,
 * or ACTION_FAILED; a blocked step with its blocked code, or
 * AUTOMATION_UNSUPPORTED, and `blocked` set. None for a pass.
 */
export function outcomeError(outcome: StepOutcome, at: StepOf): AgentError | undefined {
  if (outcome.status === 'passed') return undefined;
  if (outcome.status === 'blocked') {
    const code = outcome.errorCode && isBlockedCode(outcome.errorCode) ? outcome.errorCode : 'AUTOMATION_UNSUPPORTED';
    return new AgentError(code, outcome.summary, {...at, blocked: true});
  }
  return new AgentError(outcome.errorCode ?? 'ACTION_FAILED', outcome.summary, at);
}
