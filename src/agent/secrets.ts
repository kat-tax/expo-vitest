/**
 * Secrets as handles, and values made new each run. `secret(name)` answers
 * an object with the name and what it is for, and no value: the value is the
 * store's, which the runner alone asks when it fills a field itself. A handle
 * that reaches JSON, a log or the model shows its name and nothing else.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {Secret, Unique} from './types.ts';

/** The shortest a secret's value may be: shorter, and the redactor would match ordinary words. */
export const SECRET_FLOOR = 6;

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A secret's handle. A name ending in PASSWORD is a password, which goes into a password field only, unless `purpose` says otherwise. */
export function secret(name: string, options: {purpose?: 'password' | 'generic'} = {}): Secret {
  if (typeof name !== 'string' || !NAME.test(name)) throw new HarnessError('INVALID_ARGUMENT', `${JSON.stringify(name)} is not a secret's name: a letter, then letters, digits and underscores`);
  const purpose = options.purpose ?? (/password$/i.test(name) ? 'password' : 'generic');
  const handle = {kind: 'secret' as const, name, purpose, toJSON: () => ({secret: name})};
  // toJSON is a method of the handle's own, so it is not one of its enumerable fields.
  Object.defineProperty(handle, 'toJSON', {enumerable: false});
  return Object.freeze(handle);
}

export function isSecret(value: unknown): value is Secret {
  return typeof value === 'object' && value !== null && (value as {kind?: unknown}).kind === 'secret' && typeof (value as {name?: unknown}).name === 'string';
}

/** A value made new each run, such as an email address to sign up with. A replay keeps its slot, and fills it with the run's value. */
export function unique(value: unknown): Unique {
  if (typeof value !== 'string') throw new HarnessError('INVALID_ARGUMENT', `unique takes a string, not ${value === null ? 'null' : typeof value}`);
  if (value.trim() === '') throw new HarnessError('INVALID_ARGUMENT', 'unique takes a value with something in it');
  if (value.includes('{{param:')) throw new HarnessError('INVALID_ARGUMENT', 'unique cannot hold {{param:, which is how a replay marks its slot');
  return Object.freeze({kind: 'unique' as const, value});
}

export function isUnique(value: unknown): value is Unique {
  return typeof value === 'object' && value !== null && (value as {kind?: unknown}).kind === 'unique' && typeof (value as {value?: unknown}).value === 'string';
}

/** What the harness config's `secrets` holds: a value, or a function that answers one when it is first needed. */
export type SecretSource = Record<string, string | undefined | (() => string | Promise<string>)>;

/**
 * The run's secret values: the environment's `HARNESS_SECRET_<NAME>` over
 * the harness config's `secrets`. A function is called once, when its value
 * is first needed. Every value it has handed out, and every static one, is
 * known to the redactor.
 */
export class SecretStore {
  private readonly configured: SecretSource;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly resolved = new Map<string, string>();

  constructor(configured: SecretSource = {}, environment: NodeJS.ProcessEnv = process.env) {
    this.configured = configured;
    this.environment = environment;
    for (const [name, value] of Object.entries(configured)) {
      if (!NAME.test(name)) throw new HarnessError('INVALID_CONFIG', `secrets: ${JSON.stringify(name)} is not a secret's name: a letter, then letters, digits and underscores`);
      if (typeof value === 'string') this.remember(name, value);
      else if (value !== undefined && typeof value !== 'function') throw new HarnessError('INVALID_CONFIG', `secrets.${name} is ${typeof value}; it takes a string, or a function that answers one`);
    }
    for (const [key, value] of Object.entries(environment)) {
      if (key.startsWith('HARNESS_SECRET_') && value) this.remember(key.slice('HARNESS_SECRET_'.length), value);
    }
  }

  /** Whether a secret has a value to be had, from the environment or the config. */
  has(name: string): boolean {
    return this.resolved.has(name) || typeof this.configured[name] === 'function';
  }

  /** A secret's value, for the runner to type: the environment's, the config's, or what the config's function answers. */
  async valueOf(name: string): Promise<string> {
    const known = this.resolved.get(name);
    if (known !== undefined) return known;
    const source = this.configured[name];
    if (typeof source !== 'function') throw new HarnessError('SECRET_UNAVAILABLE', `the secret ${name} has no value: set HARNESS_SECRET_${name}, or give it under secrets in the harness config`);
    const value = await source();
    if (typeof value !== 'string' || value === '') throw new HarnessError('SECRET_UNAVAILABLE', `the secret ${name}'s function answered no value`);
    this.remember(name, value);
    return value;
  }

  /** Every value the redactor must hide, by the secret it belongs to. */
  known(): readonly {name: string; value: string}[] {
    return [...this.resolved].map(([name, value]) => ({name, value}));
  }

  private remember(name: string, value: string): void {
    if (value.length < SECRET_FLOOR) throw new HarnessError('INVALID_CONFIG', `the secret ${name} is shorter than ${SECRET_FLOOR} characters, so hiding it would hide ordinary words too`);
    this.resolved.set(name, value);
  }
}
