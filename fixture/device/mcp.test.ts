// The MCP server as a coding agent has it: the packed package's
// expo-harness mcp, spoken to over its stdin and stdout, opening a session
// on the page the harness config's command serves. Every line it writes to
// stdout must be JSON, since one stray line ends a client's session.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {onlyOn} from 'expo-vitest/device';

interface Message {
  id?: number;
  result?: {content?: {type: string; text: string}[]; isError?: true; structuredContent?: Record<string, unknown>} & Record<string, unknown>;
  error?: {code: number; message: string};
}

/** A client over a server it starts: each request answered by its id, every line it read kept. */
function connect() {
  const bin = path.join(process.cwd(), 'node_modules', 'expo-vitest', 'dist', 'harness', 'index.js');
  const child = spawn(process.execPath, [bin, 'mcp', '--platform', 'web'], {cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe']});
  const lines: string[] = [];
  const waiting = new Map<number, (message: Message) => void>();
  let buffer = '';
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      lines.push(line);
      const message = JSON.parse(line) as Message;
      if (message.id !== undefined) waiting.get(message.id)?.(message);
    }
  });
  let id = 0;
  const request = (method: string, params?: unknown) =>
    new Promise<Message>(resolve => {
      id += 1;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, ...(params === undefined ? {} : {params})})}\n`);
    });
  const notify = (method: string) => void child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method})}\n`);
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  return {request, notify, lines, exited, end: () => child.stdin.end(), stderr: () => stderr};
}

onlyOn(['web'], () => {
  it('opens a session on the page, observes, locates, taps and closes, every line it writes JSON', async () => {
    const server = connect();
    const hello = await server.request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'fixture', version: '1'}});
    expect(hello.result).toMatchObject({protocolVersion: '2025-06-18', serverInfo: {name: 'expo-harness'}});
    server.notify('notifications/initialized');
    const listed = await server.request('tools/list');
    const tools = (listed.result as {tools: {name: string}[]}).tools;
    expect(tools.map(tool => tool.name)).toEqual(['open_session', 'tools', 'call', 'close_session']);

    const opened = await server.request('tools/call', {name: 'open_session', arguments: {}});
    const first = opened.result?.content?.[0]?.text ?? '';
    expect(first, server.stderr()).toMatch(/^session s1 on web /);
    expect(first).toContain('button  "Save"  #save');

    const located = await server.request('tools/call', {name: 'call', arguments: {tool: 'locate', args: {role: 'button', name: 'Save'}}});
    const found = located.result?.structuredContent as {count: number; suggestion: string; matches: {ref: string}[]};
    expect([found.count, found.suggestion]).toEqual([1, 'screen.getByRole("button", {name: "Save"})']);

    const tapped = await server.request('tools/call', {name: 'call', arguments: {tool: 'tap', args: {ref: found.matches[0]?.ref}}});
    expect(tapped.result?.isError).toBeUndefined();
    const stale = await server.request('tools/call', {name: 'call', arguments: {tool: 'tap', args: {ref: '@e999'}}});
    expect(stale.result).toMatchObject({isError: true, content: [{text: expect.stringMatching(/^NODE_STALE: /)}]});

    const closed = await server.request('tools/call', {name: 'call', arguments: {tool: 'observe'}});
    expect(closed.result?.content?.[0]?.text).toContain('button  "Save"');
    expect((await server.request('tools/call', {name: 'close_session', arguments: {}})).result?.content?.[0]?.text).toBe('closed s1');
    server.end();
    expect(await server.exited).toBe(0);
    expect(server.lines.every(line => line.startsWith('{"jsonrpc":"2.0"'))).toBe(true);
  });
});
