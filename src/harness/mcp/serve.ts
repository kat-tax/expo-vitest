/**
 * `expo-harness mcp`: the MCP server over stdin and stdout, each session
 * on a driver the harness makes, for the app the project's harness config
 * names. stdout is the protocol's alone, so everything the process would
 * print otherwise goes to stderr: one stray line ends the session.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {SecretStore} from '../../agent/secrets.ts';
import {toolsOn} from '../../agent/tools.ts';
import type {Started} from '../../device/app-process.ts';
import {startCommand} from '../../device/app-process.ts';
import {capabilitiesOf} from '../../device/capabilities.ts';
import {findHarnessFile, loadHarness, resolveRun} from '../../device/config.ts';
import {system} from '../../device/system.ts';
import {driverFor} from '../lib/drivers.ts';
import {HarnessError} from '../lib/errors.ts';
import {DEFAULT_TIMING, timingFor, withTiming} from '../lib/settle.ts';
import type {Platform} from '../lib/types.ts';
import {PLATFORMS} from '../lib/types.ts';
import type {McpOptions} from './args.ts';
import {MCP_USAGE, parseMcpArgs} from './args.ts';
import {createCatalog} from './catalog.ts';
import {streamTransport} from './rpc.ts';
import type {McpSession, OpenArgs} from './server.ts';
import {McpServer} from './server.ts';

/** The first platform this machine can drive now, for a session that names none. */
async function firstReady(root: string): Promise<Platform> {
  for (const platform of PLATFORMS) {
    const driver = driverFor(platform, {root});
    const state = await driver.available().catch(() => ({ready: false}));
    await driver.close();
    if (state.ready) return platform;
  }
  throw new HarnessError('DRIVER_UNAVAILABLE', 'this machine can drive no platform now; expo-harness doctor says why');
}

/**
 * A session: the app the harness config names, its command started where
 * none answers yet and used as it is where one does, a driver on it, and the
 * catalog over that driver.
 */
async function openSession(args: OpenArgs, defaults: McpOptions, root: string, keep: (store: SecretStore) => void): Promise<McpSession> {
  const platform = (args.target ?? defaults.platform ?? (await firstReady(root))) as Platform;
  if (!PLATFORMS.includes(platform)) throw new HarnessError('INVALID_ARGUMENT', `${platform} is not a platform: ${PLATFORMS.join(', ')}`);
  const file = findHarnessFile(root, args.config ?? defaults.config);
  const config = await loadHarness(file, each => import(/* @vite-ignore */ pathToFileURL(each).href));
  const run = resolveRun(platform, config, process.env, root);
  // A coding agent's app is often served already, by the agent or the person: a session uses it as it is.
  const started: Started | undefined = run.command && run.readyUrl ? await startCommand(platform, {...run.command, reuseExisting: true}, run.readyUrl, system) : undefined;
  const headed = args.headed ?? defaults.headed;
  // The web driver reads whether to show its window as it is made.
  const before = process.env.HARNESS_HEADED;
  if (headed) process.env.HARNESS_HEADED = '1';
  const driver = driverFor(platform, {
    root,
    ...(run.url ? {url: run.url} : {}),
    ...(run.scheme ? {scheme: run.scheme} : {}),
    ...(run.target ? {target: run.target} : {}),
    force: args.force ?? defaults.force,
    actionTimeout: run.actionTimeout,
  });
  if (headed) {
    if (before === undefined) delete process.env.HARNESS_HEADED;
    else process.env.HARNESS_HEADED = before;
  }
  const state = await driver.available();
  if (!state.ready) {
    await driver.close();
    await started?.stop();
    throw new HarnessError('DRIVER_UNAVAILABLE', `no ${platform} device to drive: ${state.reason}`, {platform});
  }
  const timed = withTiming(driver, timingFor(DEFAULT_TIMING, {settle: run.settle, transition: run.transition}));
  if (platform === 'web') await timed.open('/');
  const secrets = new SecretStore(config?.secrets, process.env);
  keep(secrets);
  const controller = new AbortController();
  const catalog = createCatalog({
    host: {
      platform,
      ready: async () => timed,
      snapshot: () => timed.snapshot(),
      capabilities: capabilitiesOf(platform, state.device ? {device: state.device} : {}),
      scratch: path.join(root, '.harness', 'mcp'),
      ...(run.scheme ? {scheme: run.scheme} : {}),
    },
    secrets,
    tools: toolsOn(config?.agents?.default?.tools ?? [], platform),
    signal: controller.signal,
  });
  return {
    platform,
    ...(state.found ? {source: state.found} : {}),
    config: file,
    catalog,
    close: async () => {
      controller.abort();
      await timed.close();
      await started?.stop();
    },
  };
}

/** Runs the server until its input ends or it is told to stop; the exit code. */
export async function serve(args: readonly string[], root: string): Promise<number> {
  // The drivers and the harness print as they go, and stdout is the protocol's.
  console.log = console.error;
  console.info = console.error;
  let options: McpOptions;
  try {
    options = parseMcpArgs(args);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (options.help) {
    console.error(MCP_USAGE);
    return 0;
  }
  const version = (JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {version: string}).version;
  let store: SecretStore | undefined;
  const server = new McpServer({
    version,
    maxSessions: options.maxSessions,
    open: openArgs => openSession(openArgs, options, root, kept => void (store = kept)),
    configOf: openArgs => findHarnessFile(root, openArgs.config ?? options.config),
    secrets: () => store?.known() ?? [],
  });
  const transport = streamTransport(process.stdin, process.stdout);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  const pending = new Set<Promise<void>>();
  for await (const line of transport.lines) {
    if (!line.trim()) continue;
    // Each request in its own time, so a long call never holds up a ping.
    const handled = server
      .handle(line)
      .then(reply => (reply ? transport.send(reply) : undefined))
      .catch((error: unknown) => console.error(`expo-harness mcp: ${(error as Error).message}`));
    pending.add(handled);
    void handled.finally(() => pending.delete(handled));
  }
  await Promise.allSettled(pending);
  await server.close();
  return 0;
}
