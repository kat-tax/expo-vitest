import util from 'node:util';
import {describe, expect, it, vi} from 'vitest';
import {isHarnessError} from '../harness/lib/errors.ts';
import {SECRET_FLOOR, SecretStore, isSecret, isUnique, secret, unique} from './secrets.ts';

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;
const failure = async (work: () => unknown) => {
  try {
    await work();
    return null;
  } catch (error) {
    if (isHarnessError(error)) return [error.code, error.message];
    throw error;
  }
};

describe('a secret', () => {
  it('is a handle with its name and what it is for, and no value anywhere on it', () => {
    const handle = secret('ADA_PASSWORD');
    expect(handle).toEqual({kind: 'secret', name: 'ADA_PASSWORD', purpose: 'password'});
    expect(Object.keys(handle)).toEqual(['kind', 'name', 'purpose']);
    expect(JSON.stringify({password: handle})).toBe('{"password":{"secret":"ADA_PASSWORD"}}');
    expect(util.inspect(handle)).not.toMatch(/value/);
    expect(Object.isFrozen(handle)).toBe(true);
  });

  it('is a password by a name that ends in PASSWORD, or as the test says', () => {
    expect(secret('API_TOKEN').purpose).toBe('generic');
    expect(secret('adminPassword').purpose).toBe('password');
    expect(secret('PIN_CODE', {purpose: 'password'}).purpose).toBe('password');
    expect(secret('ADA_PASSWORD', {purpose: 'generic'}).purpose).toBe('generic');
  });

  it('takes a name of letters, digits and underscores, starting with a letter', async () => {
    expect(await failure(() => secret('9LIVES'))).toEqual(['INVALID_ARGUMENT', '"9LIVES" is not a secret\'s name: a letter, then letters, digits and underscores']);
    expect((await failure(() => secret('A-B')))?.[0]).toBe('INVALID_ARGUMENT');
    expect((await failure(() => secret(5 as unknown as string)))?.[0]).toBe('INVALID_ARGUMENT');
  });

  it('is told apart from what is not one', () => {
    expect([isSecret(secret('TOKEN')), isSecret({kind: 'secret'}), isSecret('TOKEN'), isSecret(null)]).toEqual([true, false, false, false]);
  });
});

describe('a unique value', () => {
  it('is a value marked as made new each run', () => {
    expect(unique('ada+7f3@example.com')).toEqual({kind: 'unique', value: 'ada+7f3@example.com'});
    expect([isUnique(unique('x')), isUnique({kind: 'unique'}), isUnique(null)]).toEqual([true, false, false]);
  });

  it('is a string with something in it, and no replay slot', async () => {
    expect(await failure(() => unique(5))).toEqual(['INVALID_ARGUMENT', 'unique takes a string, not number']);
    expect(await failure(() => unique(null))).toEqual(['INVALID_ARGUMENT', 'unique takes a string, not null']);
    expect(await failure(() => unique('  '))).toEqual(['INVALID_ARGUMENT', 'unique takes a value with something in it']);
    expect(await failure(() => unique('a {{param:x}}'))).toEqual(['INVALID_ARGUMENT', 'unique cannot hold {{param:, which is how a replay marks its slot']);
  });
});

describe("the run's secrets", () => {
  it("take the environment's value over the config's, and name one only the environment has", async () => {
    const store = new SecretStore({ADA_PASSWORD: 'correct-horse'}, env({HARNESS_SECRET_ADA_PASSWORD: 'battery-staple', HARNESS_SECRET_API_TOKEN: 'tok_123456', OTHER: 'x'}));
    expect(await store.valueOf('ADA_PASSWORD')).toBe('battery-staple');
    expect(await store.valueOf('API_TOKEN')).toBe('tok_123456');
    expect([store.has('ADA_PASSWORD'), store.has('API_TOKEN'), store.has('NOPE')]).toEqual([true, true, false]);
    expect(store.known()).toEqual([
      {name: 'ADA_PASSWORD', value: 'battery-staple'},
      {name: 'API_TOKEN', value: 'tok_123456'},
    ]);
  });

  it('call a function once, when its value is first needed, and hide what it answered', async () => {
    const fetchToken = vi.fn(async () => 'fetched-token');
    const store = new SecretStore({TOKEN: fetchToken, UNSET: undefined}, env());
    expect(store.has('TOKEN')).toBe(true);
    expect(store.known()).toEqual([]);
    expect(await store.valueOf('TOKEN')).toBe('fetched-token');
    expect(await store.valueOf('TOKEN')).toBe('fetched-token');
    expect(fetchToken).toHaveBeenCalledOnce();
    expect(store.known()).toEqual([{name: 'TOKEN', value: 'fetched-token'}]);
    expect(store.has('UNSET')).toBe(false);
  });

  it('say which secret has no value, and how to give it one', async () => {
    const store = new SecretStore({EMPTY: () => '', NONE: undefined}, env());
    expect(await failure(() => store.valueOf('NONE'))).toEqual(['SECRET_UNAVAILABLE', 'the secret NONE has no value: set HARNESS_SECRET_NONE, or give it under secrets in the harness config']);
    expect(await failure(() => store.valueOf('EMPTY'))).toEqual(['SECRET_UNAVAILABLE', "the secret EMPTY's function answered no value"]);
    expect(await failure(() => new SecretStore().valueOf('ABSENT'))).toEqual(['SECRET_UNAVAILABLE', 'the secret ABSENT has no value: set HARNESS_SECRET_ABSENT, or give it under secrets in the harness config']);
  });

  it(`refuse a value shorter than ${SECRET_FLOOR} characters, a bad name, and a value of the wrong kind`, async () => {
    expect(await failure(() => new SecretStore({PIN: '1234'}, env()))).toEqual(['INVALID_CONFIG', 'the secret PIN is shorter than 6 characters, so hiding it would hide ordinary words too']);
    expect((await failure(() => new SecretStore({}, env({HARNESS_SECRET_PIN: '1234'}))))?.[0]).toBe('INVALID_CONFIG');
    expect((await failure(() => new SecretStore({SHORT: () => 'abc'}, env()).valueOf('SHORT')))?.[0]).toBe('INVALID_CONFIG');
    expect(await failure(() => new SecretStore({'bad-name': 'abcdefgh'}, env()))).toEqual(['INVALID_CONFIG', 'secrets: "bad-name" is not a secret\'s name: a letter, then letters, digits and underscores']);
    expect(await failure(() => new SecretStore({TOKEN: 42 as unknown as string}, env()))).toEqual(['INVALID_CONFIG', 'secrets.TOKEN is number; it takes a string, or a function that answers one']);
  });
});
