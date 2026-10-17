import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {callsTool, says, scriptedModel, usage} from './__fixtures__/model.ts';
import {EXTRACT_PROMPT, JUDGE_PROMPT, VERDICT_TOOL, extract, judge, verdictError, viewChanged, waitFor} from './judge.ts';
import type {JudgeInput, Look} from './judge.ts';
import {sleep, stepSignal} from './step.ts';
import type {AgentError, ImagePart, Model, StandardSchemaV1} from './types.ts';

const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: false, ...extra});

/** The upload screen, with its status saying what it says. */
const upload = (status: string, statusRef = '@e2', route?: string): Look => {
  const snapshot: Snapshot = {platform: 'web', nodes: [node('@e1', 'heading', 'Upload', {heading: 1}), node(statusRef, 'status', status, {live: 'polite'})]};
  return {snapshot, view: `@e1  heading  "Upload"  h1\n${statusRef}  status  ${JSON.stringify(status)}  live:polite`, ...(route ? {route} : {})};
};

const picture: ImagePart = {type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=', width: 768, height: 432};
const verdict = (value: string, explanation: string) => callsTool('verdict', {verdict: value, explanation});
const live = () => new AbortController().signal;

const input = (model: Model, extra: Partial<JudgeInput> = {}): JudgeInput => ({kind: 'assert', statement: 'the upload has finished', look: upload('Done'), model, signal: live(), ...extra});

/** What a promise rejected with. */
const rejection = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as AgentError);

describe('a verdict', () => {
  it('is one call: the judge prompt, the context, the statement and the screen, the verdict tool, at low effort', async () => {
    const model = scriptedModel([verdict('pass', 'The status reads Done.')]);
    const judged = await judge(input(model, {context: 'A file manager.'}));
    expect(judged).toEqual({value: 'pass', explanation: 'The status reads Done.', calls: 1, usage: usage(), models: ['claude-opus-5-5']});
    const [request] = model.requests;
    expect(request?.system).toEqual([{text: JUDGE_PROMPT}, {text: 'About the app:\nA file manager.', cache: true}]);
    expect(request?.messages).toEqual([
      {
        role: 'user',
        content: [
          {type: 'text', text: 'Statement: the upload has finished'},
          {type: 'text', text: 'The screen now:\n@e1  heading  "Upload"  h1\n@e2  status  "Done"  live:polite'},
        ],
      },
    ]);
    expect([request?.tools, request?.effort, request?.format]).toEqual([[VERDICT_TOOL], 'low', undefined]);
  });

  it('says nothing more is known of an app with no context, and takes the effort it is given', async () => {
    const model = scriptedModel([verdict('fail', 'It reads Uploading.')]);
    await judge(input(model, {effort: 'medium'}));
    expect([model.requests[0]?.system[1], model.requests[0]?.effort]).toEqual([{text: 'About the app: nothing more is known.', cache: true}, 'medium']);
  });

  it('carries the picture after the view, or the picture alone', async () => {
    const model = scriptedModel([verdict('pass', 'Done.'), verdict('pass', 'Done.')]);
    await judge(input(model, {look: {...upload('Done'), image: picture}}));
    await judge(input(model, {look: {...upload('Done'), image: picture}, imageOnly: true}));
    expect(model.requests[0]?.messages[0]?.content).toHaveLength(3);
    expect(model.requests[0]?.messages[0]?.content[2]).toBe(picture);
    expect(model.requests[1]?.messages[0]?.content).toEqual([{type: 'text', text: 'Statement: the upload has finished'}, picture]);
  });

  it('asks once more where the model called no verdict tool, appending to the first turn', async () => {
    const model = scriptedModel([says('It looks finished to me.', {raw: [{type: 'text', text: 'It looks finished to me.'}]}), verdict('pass', 'The status reads Done.')]);
    const judged = await judge(input(model));
    expect([judged.value, judged.calls, judged.usage, judged.models]).toEqual(['pass', 2, usage(200, 20), ['claude-opus-5-5', 'claude-opus-5-5']]);
    const [first, second] = model.requests;
    expect(second?.messages.slice(0, 1)).toEqual(first?.messages);
    expect(second?.messages.slice(1)).toEqual([
      {role: 'assistant', content: [{type: 'text', text: 'It looks finished to me.'}], raw: [{type: 'text', text: 'It looks finished to me.'}]},
      {role: 'user', content: [{type: 'text', text: 'That answer could not be used: it called no verdict tool, and the verdict tool is the answer. Answer again.'}]},
    ]);
  });

  it('answers a verdict it cannot read with an error result, naming what is wrong', async () => {
    const wrong = verdict('maybe', 'Hard to say.');
    const model = scriptedModel([wrong, verdict('inconclusive', 'The status is cut off.')]);
    expect((await judge(input(model))).value).toBe('inconclusive');
    expect(model.requests[1]?.messages[2]).toEqual({
      role: 'user',
      content: [{type: 'tool_result', toolUseId: wrong.toolCalls[0]?.id, content: [{type: 'text', text: '$.verdict is "maybe", not one of "pass", "fail", "inconclusive". Answer again.'}], isError: true}],
    });
  });

  it('is MODEL_OUTPUT_INVALID where the repair is no better, or where no repair is left', async () => {
    const twice = await rejection(judge(input(scriptedModel([says('Done.'), says('Done!')]))));
    expect([twice?.code, twice?.message]).toEqual([
      'MODEL_OUTPUT_INVALID',
      'agent.assert("the upload has finished"): the model\'s answer could not be used, even after a repair: it called no verdict tool, and the verdict tool is the answer',
    ]);
    const once = await rejection(judge(input(scriptedModel([callsTool('verdict', {verdict: 'pass'})])), 1));
    expect(once?.explanation).toBe("the model's answer could not be used: $.explanation is missing");
  });
});

describe('the error a verdict fails its step with', () => {
  const judged = (value: 'pass' | 'fail' | 'inconclusive') => ({value, explanation: 'The status reads Uploading.', calls: 1, usage: usage(), models: ['claude-opus-5-5']});
  const at = {step: 'assert' as const, instruction: 'the upload has finished'};

  it('is none for a pass, ASSERTION_FAILED for a fail, ASSERTION_INCONCLUSIVE for an inconclusive, with the screenshot kept', () => {
    expect(verdictError(at, judged('pass'))).toBeUndefined();
    const failed = verdictError(at, judged('fail'), '.harness/evidence/upload/after-verdict.png');
    expect([failed?.code, failed?.message, failed?.screenshot]).toEqual(['ASSERTION_FAILED', 'agent.assert("the upload has finished"): The status reads Uploading.', '.harness/evidence/upload/after-verdict.png']);
    const unsure = verdictError(at, judged('inconclusive'));
    expect([unsure?.code, unsure?.screenshot, 'screenshot' in (unsure as object)]).toEqual(['ASSERTION_INCONCLUSIVE', undefined, false]);
  });
});

describe('whether the screen changed', () => {
  it('is yes at the first look, no where only a ref moved, and yes where a text or the route changed', () => {
    expect(viewChanged(null, upload('Uploading'))).toBe(true);
    expect(viewChanged(upload('Uploading'), upload('Uploading', '@e9'))).toBe(false);
    expect(viewChanged(upload('Uploading 40%'), upload('Uploading 41%'))).toBe(true);
    expect(viewChanged(upload('Done', '@e2', '/upload'), upload('Done', '@e2', '/files'))).toBe(true);
  });
});

describe('a wait', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const at = {step: 'waitFor' as const, instruction: 'the upload has finished'};

  /** Looks that follow a script, the last one repeating, each look's time kept. */
  function looks(...screens: Look[]) {
    const times: number[] = [];
    let index = 0;
    const look = async () => {
      times.push(Date.now());
      return screens[Math.min(index++, screens.length - 1)] as Look;
    };
    return {look, times};
  }

  it('calls the judge only when the screen changed, and ends on the pass', async () => {
    const model = scriptedModel([verdict('fail', 'It reads Uploading.'), verdict('pass', 'It reads Done.')]);
    const {look, times} = looks(upload('Uploading'), upload('Uploading', '@e7'), upload('Uploading'), upload('Done'));
    const step = stepSignal(at, 30_000);
    const waiting = waitFor({statement: 'the upload has finished', look, interval: 3000, maxModelCalls: 25, model, signal: step.signal});
    await vi.advanceTimersByTimeAsync(9000);
    const judged = await waiting;
    step.dispose();
    expect([judged.value, judged.explanation, judged.calls, judged.usage, times.length]).toEqual(['pass', 'It reads Done.', 2, usage(200, 20), 4]);
    expect(model.requests.map(request => request.messages[0]?.content[0])).toEqual([
      {type: 'text', text: 'Condition: the upload has finished'},
      {type: 'text', text: 'Condition: the upload has finished'},
    ]);
  });

  it('looks an interval after the last look began, or at once where the judge took longer', async () => {
    const slow = (ms: number, reply: ReturnType<typeof verdict>) => async () => {
      await sleep(ms, live());
      return reply;
    };
    const model = scriptedModel([slow(1000, verdict('fail', 'Uploading.')), slow(5000, verdict('fail', 'Still.')), verdict('pass', 'Done.')]);
    const {look, times} = looks(upload('Uploading 1%'), upload('Uploading 2%'), upload('Done'));
    const step = stepSignal(at, 30_000);
    const waiting = waitFor({statement: 'the upload has finished', look, interval: 3000, maxModelCalls: 25, model, signal: step.signal});
    await vi.advanceTimersByTimeAsync(9000);
    await waiting;
    step.dispose();
    const start = times[0] as number;
    expect(times.map(time => time - start)).toEqual([0, 3000, 8000]);
  });

  it('is ASSERTION_FAILED at the timeout, with what the last verdict rested on', async () => {
    const model = scriptedModel([verdict('fail', 'The status reads Uploading.')]);
    const step = stepSignal(at, 10_000);
    const waiting = rejection(waitFor({statement: 'the upload has finished', look: looks(upload('Uploading')).look, interval: 3000, maxModelCalls: 25, model, signal: step.signal}));
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await waiting;
    expect([error?.code, error?.message, (error?.cause as AgentError | undefined)?.code]).toEqual([
      'ASSERTION_FAILED',
      'agent.waitFor("the upload has finished"): it ran past its timeout of 10000 ms, and the condition did not hold: The status reads Uploading.',
      'STEP_TIMEOUT',
    ]);
    expect(model.requests).toHaveLength(1);
  });

  it('is ASSERTION_FAILED where the timeout came during a call, before any verdict', async () => {
    const model: Model = {
      id: 'stuck',
      complete: request => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')))),
    };
    const step = stepSignal(at, 5000);
    const waiting = rejection(waitFor({statement: 'the upload has finished', look: looks(upload('Uploading')).look, interval: 3000, maxModelCalls: 25, model, signal: step.signal}));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await waiting)?.explanation).toBe('it ran past its timeout of 5000 ms, and the condition did not hold: the screen was never judged');
  });

  it("is the test's cancel as it is, and a failed judgment as it is", async () => {
    const test = new AbortController();
    const step = stepSignal(at, 30_000, test.signal);
    const model = scriptedModel([verdict('fail', 'Uploading.')]);
    const waiting = rejection(waitFor({statement: 'the upload has finished', look: looks(upload('Uploading')).look, interval: 3000, maxModelCalls: 25, model, signal: step.signal}));
    await vi.advanceTimersByTimeAsync(1000);
    test.abort();
    expect((await waiting)?.code).toBe('CANCELLED');
    step.dispose();

    const broken = scriptedModel([says('Done?'), says('Done!')]);
    const failed = await rejection(waitFor({statement: 'the upload has finished', look: looks(upload('Done')).look, interval: 3000, maxModelCalls: 25, model: broken, signal: live()}));
    expect(failed?.code).toBe('MODEL_OUTPUT_INVALID');
  });

  it('is STEP_BUDGET_EXHAUSTED once its calls are spent, and gives the last call no repair', async () => {
    const model = scriptedModel([verdict('fail', 'At 1%.'), verdict('fail', 'At 2%.')]);
    const {look} = looks(upload('Uploading 1%'), upload('Uploading 2%'), upload('Uploading 3%'));
    const waiting = rejection(waitFor({statement: 'the upload has finished', look, interval: 100, maxModelCalls: 2, model, signal: live()}));
    await vi.advanceTimersByTimeAsync(300);
    const error = await waiting;
    expect([error?.code, error?.explanation]).toEqual(['STEP_BUDGET_EXHAUSTED', 'it made 2 model calls, its budget, and the condition did not hold: At 2%.']);

    const malformed = scriptedModel([verdict('fail', 'At 1%.'), says('Nearly.')]);
    const last = rejection(waitFor({statement: 'the upload has finished', look: looks(upload('Uploading 1%'), upload('Uploading 2%')).look, interval: 100, maxModelCalls: 2, model: malformed, signal: live()}));
    await vi.advanceTimersByTimeAsync(200);
    expect((await last)?.explanation).toBe("the model's answer could not be used: it called no verdict tool, and the verdict tool is the answer");
  });
});

describe('an extraction', () => {
  const total = (extra: Partial<Parameters<typeof extract>[0]> = {}) => ({
    statement: 'the order total as a number',
    look: {snapshot: {platform: 'web' as const, nodes: [node('@e4', 'StaticText', 'Total $42.50', {kind: 'text'})]}, view: '@e4  text  "Total $42.50"'},
    model: scriptedModel([]),
    signal: live(),
    schema: {type: 'number'},
    ...extra,
  });
  const answer = (found: boolean, value: unknown, explanation = 'The total line reads $42.50.') => says(JSON.stringify({found, value, explanation}));

  it('sends a JSON Schema as the format, inside what says whether it was found, and answers the value', async () => {
    const model = scriptedModel([answer(true, 42.5)]);
    const extracted = await extract(total({model, context: 'A shop.'}));
    expect([extracted.value, extracted.explanation, extracted.calls]).toEqual([42.5, 'The total line reads $42.50.', 1]);
    const [request] = model.requests;
    expect(request?.system).toEqual([{text: EXTRACT_PROMPT}, {text: 'About the app:\nA shop.', cache: true}]);
    expect(request?.messages[0]?.content[0]).toEqual({type: 'text', text: 'Read: the order total as a number'});
    expect([request?.tools, request?.effort]).toEqual([[], 'low']);
    expect(request?.format).toEqual({
      type: 'object',
      properties: {found: {type: 'boolean'}, value: {anyOf: [{type: 'number'}, {type: 'null'}]}, explanation: {type: 'string'}},
      required: ['found', 'value', 'explanation'],
      additionalProperties: false,
    });
  });

  it('is ASSERTION_INCONCLUSIVE where the screen does not show it, never a placeholder', async () => {
    const error = await rejection(extract(total({model: scriptedModel([answer(false, null, 'No total is on the screen.')])})));
    expect([error?.code, error?.message]).toEqual(['ASSERTION_INCONCLUSIVE', 'agent.extract("the order total as a number"): No total is on the screen.']);
  });

  it('asks again where the answer is not JSON, not the shape, or not what the schema allows', async () => {
    const model = scriptedModel([says('The total is 42.50'), answer(true, '42.50')]);
    expect((await rejection(extract(total({model}))))?.explanation).toBe("the model's answer could not be used, even after a repair: $.value is string, where number is wanted");
    expect(model.requests[1]?.messages[2]).toEqual({role: 'user', content: [{type: 'text', text: 'That answer could not be used: it is not JSON. Answer again.'}]});
    const shape = scriptedModel([says('{"found": true, "value": 42.5}'), answer(true, 42.5)]);
    expect((await extract(total({model: shape}))).value).toBe(42.5);
    expect(shape.requests[1]?.messages[2]?.content[0]).toEqual({type: 'text', text: 'That answer could not be used: $.explanation is missing. Answer again.'});
  });

  it("validates with a Standard Schema's own check, awaited, and answers its output", async () => {
    const validate = vi.fn(async (value: unknown) => (typeof value === 'number' ? {value: Math.round(value * 100)} : {issues: [{message: 'Expected number'}]}));
    const cents: StandardSchemaV1<number> = {'~standard': {version: 1, vendor: 'zod', validate, jsonSchema: {output: ({target}) => ({type: 'number', description: target})}}};
    const model = scriptedModel([answer(true, 42.5)]);
    const extracted = await extract(total({model, schema: cents}));
    expect([extracted.value, validate.mock.calls]).toEqual([4250, [[42.5]]]);
    expect((model.requests[0]?.format as {properties: {value: unknown}} | undefined)?.properties.value).toEqual({anyOf: [{type: 'number', description: 'draft-07'}, {type: 'null'}]});
  });

  it('asks for JSON in text where a Standard Schema gives no JSON Schema or cannot express its own, and repairs with its issues', async () => {
    const order: StandardSchemaV1<{total: number}> = {
      '~standard': {
        version: 1,
        vendor: 'valibot',
        validate: value =>
          typeof (value as {total?: unknown}).total === 'number'
            ? {value: value as {total: number}}
            : {issues: [{message: 'Expected number', path: [{key: 'total'}]}, {message: 'Expected a currency', path: ['currency']}, {message: 'Invalid'}]},
      },
    };
    const model = scriptedModel([says('```json\n{"found": true, "value": {"total": "42.50"}, "explanation": "The total line."}\n```'), says('{"found": true, "value": {"total": 42.5}, "explanation": "The total line."}')]);
    const extracted = await extract(total({model, schema: order}));
    expect([extracted.value, extracted.calls, model.requests[0]?.format]).toEqual([{total: 42.5}, 2, undefined]);
    expect(model.requests[1]?.messages[2]?.content[0]).toEqual({
      type: 'text',
      text: 'That answer could not be used: $.value.total: Expected number; $.value.currency: Expected a currency; $.value: Invalid. Answer again.',
    });

    const transform: StandardSchemaV1<number> = {
      '~standard': {
        version: 1,
        vendor: 'zod',
        validate: value => ({value: Number(value)}),
        jsonSchema: {
          output: () => {
            throw new Error('Transforms cannot be represented in JSON Schema');
          },
        },
      },
    };
    const text = scriptedModel([answer(true, '42.50')]);
    expect((await extract(total({model: text, schema: transform}))).value).toBe(42.5);
    expect(text.requests[0]?.format).toBeUndefined();
  });

  it('is INVALID_ARGUMENT for a schema that is neither kind', async () => {
    for (const schema of ['number', null]) {
      const error = await rejection(extract(total({schema: schema as never})));
      expect([error?.code, error?.explanation]).toEqual(['INVALID_ARGUMENT', 'its schema is neither a Standard Schema nor a JSON Schema object']);
    }
  });
});
