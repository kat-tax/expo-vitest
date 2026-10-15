/**
 * `expo-harness mcp`: the MCP server over stdin and stdout, each session
 * on a driver the harness makes, for the app the project's harness config
 * names. stdout is the protocol's alone, so everything the process would
 * print otherwise goes to stderr: one stray line ends the session.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {SecretStore} from '../../agent/secrets.ts';
import {toolsOn} from '../../agent/tools.ts';
import {findHarnessFile} from '../../device/config.ts';
import {openApp, projectAt} from '../lib/app.ts';
import type {McpOptions} from './args.ts';
import {MCP_USAGE, parseMcpArgs} from './args.ts';
import {createCatalog} from './catalog.ts';
import {streamTransport} from './rpc.ts';
import type {McpSession, OpenArgs} from './server.ts';
import {McpServer} from './server.ts';

/** A session: the app the harness config names, open, and the catalog over its driver. */
async function openSession(args: OpenArgs, defaults: McpOptions, root: string, keep: (store: SecretStore) => void): Promise<McpSession> {
  const project = await projectAt(root, args.config ?? defaults.config);
  const app = await openApp(project, {platform: args.target ?? defaults.platform, headed: args.headed ?? defaults.headed, force: args.force ?? defaults.force, scratch: path.join(root, '.harness', 'mcp')}, root);
  keep(app.secrets);
  const controller = new AbortController();
  const catalog = createCatalog({host: app.host, secrets: app.secrets, tools: toolsOn(project.config?.agents?.default?.tools ?? [], app.platform), signal: controller.signal});
  return {
    platform: app.platform,
    ...(app.state.found ? {source: app.state.found} : {}),
    config: project.file,
    catalog,
    close: async () => {
      controller.abort();
      await app.close();
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
