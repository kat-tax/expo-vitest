import {PassThrough, Writable} from 'node:stream';
import {describe, expect, it} from 'vitest';
import {fail, INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, notify, PARSE_ERROR, parseLine, respond, streamTransport} from './rpc.ts';

describe('a line of stdin', () => {
  it('is a request, with its id, or a notification, without one', () => {
    expect(parseLine('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toEqual({request: {jsonrpc: '2.0', id: 1, method: 'ping'}});
    expect(parseLine('{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"call"}}')).toEqual({request: {jsonrpc: '2.0', id: 'a', method: 'tools/call', params: {name: 'call'}}});
    expect(parseLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({request: {jsonrpc: '2.0', method: 'notifications/initialized'}});
  });

  it('is PARSE_ERROR where it is not JSON, with no id to answer to', () => {
    expect(parseLine('{"jsonrpc":')).toEqual({error: {code: PARSE_ERROR, message: 'Parse error: the line is not JSON'}, id: null});
  });

  it('is INVALID_REQUEST as a batch, which this revision of the protocol took out, or anything but an object', () => {
    expect(parseLine('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).toEqual({error: {code: INVALID_REQUEST, message: 'Invalid Request: this revision of the protocol takes no batch'}, id: null});
    expect(parseLine('42')).toEqual({error: {code: INVALID_REQUEST, message: 'Invalid Request: a message is an object'}, id: null});
  });

  it('is INVALID_REQUEST without jsonrpc 2.0 or a method, answered to the id it carried, and with an id of the wrong kind', () => {
    expect(parseLine('{"id":7,"method":"ping"}')).toEqual({error: {code: INVALID_REQUEST, message: 'Invalid Request: a message needs jsonrpc "2.0" and a method'}, id: 7});
    expect(parseLine('{"jsonrpc":"2.0","id":"x","method":3}')).toMatchObject({error: {code: INVALID_REQUEST}, id: 'x'});
    expect(parseLine('{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}')).toEqual({error: {code: INVALID_REQUEST, message: 'Invalid Request: an id is a string or a number'}, id: null});
    expect(parseLine('{"jsonrpc":"2.0","id":null,"method":"ping"}')).toEqual({request: {jsonrpc: '2.0', id: null, method: 'ping'}});
  });

  it("is passed over as a response, which a server that asks nothing never awaits", () => {
    expect(parseLine('{"jsonrpc":"2.0","id":3,"result":{}}')).toEqual({response: true});
    expect(parseLine('{"jsonrpc":"2.0","id":3,"error":{"code":1,"message":"no"}}')).toEqual({response: true});
  });
});

describe('a message out', () => {
  it('is a result, an error or a notification, as one line of JSON', () => {
    expect(respond(1, {})).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');
    expect(fail(null, {code: METHOD_NOT_FOUND, message: 'Method not found: tools/run'})).toBe('{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not found: tools/run"}}');
    expect(notify('notifications/progress', {progressToken: 't', progress: 1})).toBe('{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"t","progress":1}}');
    expect(notify('notifications/tools/list_changed')).toBe('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}');
    expect([INVALID_PARAMS, INTERNAL_ERROR]).toEqual([-32602, -32603]);
  });
});

describe('the transport', () => {
  it('reads each line however it ends, and writes each message as a line', async () => {
    const input = new PassThrough();
    const written: string[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    const transport = streamTransport(input, output);
    input.end('{"a":1}\r\n{"b":2}\n{"c":3}');
    const lines: string[] = [];
    for await (const line of transport.lines) lines.push(line);
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    await transport.send('{"d":4}');
    expect(written).toEqual(['{"d":4}\n']);
  });

  it('waits for a full stream to drain before it says the message went', async () => {
    let release = () => undefined as void;
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, done) {
        release = () => done();
      },
    });
    const transport = streamTransport(new PassThrough(), output);
    let sent = false;
    const sending = transport.send('{"big":true}').then(() => void (sent = true));
    await new Promise(resolve => setImmediate(resolve));
    expect(sent).toBe(false);
    release();
    await sending;
    expect(sent).toBe(true);
  });
});
