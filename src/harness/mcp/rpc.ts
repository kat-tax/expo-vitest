/**
 * The MCP server's framing: JSON-RPC 2.0 over stdio, a message a line, as
 * the 2025-06-18 revision of the protocol has it. Pure but for the
 * transport at the end, so every rule is a unit test.
 */
import readline from 'node:readline';
import type {Readable, Writable} from 'node:stream';

export type Id = string | number | null;

export interface Request {
  jsonrpc: '2.0';
  /** Absent on a notification, which gets no response. */
  id?: Id;
  method: string;
  params?: unknown;
}

export interface Failure {
  code: number;
  message: string;
  data?: unknown;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string | number => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

/**
 * One line of stdin: a request or a notification, the error to answer with,
 * or a response, which a server that sends no requests of its own passes over.
 */
export function parseLine(line: string): {request: Request} | {error: Failure; id: Id} | {response: true} {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return {error: {code: PARSE_ERROR, message: 'Parse error: the line is not JSON'}, id: null};
  }
  // The 2025-06-18 revision took batching out of the protocol, so an array is no message at all.
  if (Array.isArray(message)) return {error: {code: INVALID_REQUEST, message: 'Invalid Request: this revision of the protocol takes no batch'}, id: null};
  if (!isObject(message)) return {error: {code: INVALID_REQUEST, message: 'Invalid Request: a message is an object'}, id: null};
  const id = isId(message.id) ? message.id : null;
  if (message.method === undefined && ('result' in message || 'error' in message)) return {response: true};
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return {error: {code: INVALID_REQUEST, message: 'Invalid Request: a message needs jsonrpc "2.0" and a method'}, id};
  if (message.id !== undefined && message.id !== null && !isId(message.id)) return {error: {code: INVALID_REQUEST, message: 'Invalid Request: an id is a string or a number'}, id: null};
  return {request: message as unknown as Request};
}

export const respond = (id: Id, result: unknown): string => JSON.stringify({jsonrpc: '2.0', id, result});
export const fail = (id: Id, error: Failure): string => JSON.stringify({jsonrpc: '2.0', id, error});
export const notify = (method: string, params?: unknown): string => JSON.stringify({jsonrpc: '2.0', method, ...(params === undefined ? {} : {params})});

/** Lines in, lines out. */
export interface Transport {
  readonly lines: AsyncIterable<string>;
  /** Writes one message as a line, and waits for the stream to drain where it is full. */
  send(line: string): Promise<void>;
}

/**
 * The transport over a pair of streams: each line of the input, however it
 * ends, and each message written whole, with a full output's `drain`
 * awaited, so a large observation never runs into the next message.
 */
export function streamTransport(input: Readable, output: Writable): Transport {
  // Made at once: readline drops the lines it reads before its iterator exists.
  const iterator = readline.createInterface({input, crlfDelay: Infinity})[Symbol.asyncIterator]();
  return {
    lines: {[Symbol.asyncIterator]: () => iterator},
    send: line =>
      new Promise(resolve => {
        if (output.write(`${line}\n`)) resolve();
        else output.once('drain', resolve);
      }),
  };
}
