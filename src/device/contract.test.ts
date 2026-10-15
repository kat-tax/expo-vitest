/**
 * The public surface, pinned. A Vitest or React Native Testing Library user
 * must not notice a change here until they reach for it, so a rename, a
 * removal, a changed default or a changed message fails this file first.
 * Additions pass: members are checked for presence and arity, options and
 * tree fields with `toMatchObjectType`, never as an exact list. Where an exact
 * shape is held (a method's parameters, the selector keys), a new one is a
 * deliberate edit to this file, in the commit that adds it.
 *
 * Half of it is types. `expectTypeOf` does nothing at run time; it fails
 * `bun run typecheck`, which checks this file because `tsconfig.json`
 * includes the tests. Take the tests out of `tsconfig.json` and that half
 * stops being checked.
 */
import os from 'node:os';
import path from 'node:path';
import type {Assertion} from 'vitest';
import {afterEach, describe, expect, expectTypeOf, it, vi} from 'vitest';
import type {ViteUserConfig} from 'vitest/config';
import {driverFor} from '../harness/lib/drivers.ts';
import {OPTIONAL_ARGUMENT, STEP_ARGUMENTS, parse, unmangleRoute} from '../harness/lib/cli.ts';
import {parseTarget} from '../harness/lib/snapshot.ts';
import type {Driver, StepResult} from '../harness/lib/types.ts';
import {failed, ok} from '../harness/lib/types.ts';
import type {ExpoProjectsOptions, Platform} from '../projects.ts';
import {deviceConfig, file, nodeProject, selfAliases} from '../projects.ts';
import type {DeviceConfig, HarnessCode, Selector, Snapshot, SnapshotNode} from './index.ts';
import {by, configFromEnvironment, device, element, isHarnessError} from './index.ts';
import './matchers.ts';

// The device makes its driver through this; a stub stands in, so no browser,
// window or phone is needed to pin what a test sees.
vi.mock('../harness/lib/drivers.ts', () => ({driverFor: vi.fn()}));

/** A driver that answers everything, with whatever a test overrides. */
function stub(overrides: Partial<Driver> = {}): Driver {
  return {
    platform: 'web',
    available: async () => ({ready: true, found: 'a stub'}),
    open: async () => ok('opened'),
    snapshot: async () => ({platform: 'web', nodes: []}),
    press: async () => ok('pressed'),
    fill: async () => ok('filled'),
    type: async () => ok('typed'),
    screenshot: async () => ok('saved'),
    idleSeconds: async () => null,
    close: async () => {},
    ...overrides,
  };
}

function drive(driver: Driver): Driver {
  vi.mocked(driverFor).mockReturnValue(driver);
  return driver;
}

/**
 * An interface as a plain object type. `toMatchObjectType` lets the actual
 * type have more fields than the expected one only when the actual type is a
 * plain object type; given an interface it demands the two be equal, and a
 * field added later would fail a contract that means to allow it.
 */
type Plain<T> = {[K in keyof T]: T[K]};

/** A thrown harness failure, matched on its code and its whole message. */
function failure(code: HarnessCode, message: string) {
  return expect.objectContaining({name: 'HarnessError', code, message});
}

afterEach(async () => {
  await device.close();
  vi.useRealTimers();
});

describe('selectors', () => {
  it('are the shapes a test writes', () => {
    expect(by.testID('x')).toStrictEqual({testId: 'x'});
    expect(by.label('x')).toStrictEqual({label: 'x'});
    expect(by.text('x')).toStrictEqual({contains: 'x'});
    expect(by.role('x')).toStrictEqual({role: 'x'});
    expect(by.ref('@e1')).toStrictEqual({ref: '@e1'});
  });

  it('read every spelling a command line gives', () => {
    // The same as snapshot.test.ts on purpose: that file may be reorganised, this one may not.
    expect(parseTarget('@e3')).toStrictEqual({ref: '@e3'});
    expect(parseTarget('label="New drop"')).toStrictEqual({label: 'New drop'});
    expect(parseTarget('role=button')).toStrictEqual({role: 'button'});
    expect(parseTarget('testID=new-drop')).toStrictEqual({testId: 'new-drop'});
    expect(parseTarget('testId="new-drop"')).toStrictEqual({testId: 'new-drop'});
    expect(parseTarget('testid=new-drop')).toStrictEqual({testId: 'new-drop'});
    expect(parseTarget('contains="x"')).toStrictEqual({contains: 'x'});
    expect(parseTarget('Settings')).toStrictEqual({label: 'Settings'});
  });
});

describe('the environment', () => {
  it('names the device with four variables, and is web when it names nothing', () => {
    expect(configFromEnvironment({} as NodeJS.ProcessEnv)).toStrictEqual({platform: 'web', url: undefined, scheme: undefined, target: undefined});
    const named = {HARNESS_PLATFORM: 'android', HARNESS_URL: 'http://localhost:8081', HARNESS_SCHEME: 'myapp', HARNESS_TARGET: 'emulator-5554'};
    expect(configFromEnvironment(named as unknown as NodeJS.ProcessEnv)).toStrictEqual({
      platform: 'android',
      url: 'http://localhost:8081',
      scheme: 'myapp',
      target: 'emulator-5554',
    });
  });
});

describe('the project root', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The device module and the matchers as a run with this root would load them. */
  async function loadedWith(root: string | undefined) {
    vi.stubEnv('HARNESS_ROOT', root);
    vi.resetModules();
    const drivers = await import('../harness/lib/drivers.ts');
    vi.mocked(drivers.driverFor).mockReturnValue(stub());
    const {device: fresh} = await import('./index.ts');
    const {baselineFor} = await import('./matchers.ts');
    return {device: fresh, baselineFor};
  }

  it('is the working directory, for baselines and for screenshots', async () => {
    const {device: fresh, baselineFor} = await loadedWith(undefined);
    expect(baselineFor('web', 'home')).toBe(path.join(process.cwd(), 'device', '__screenshots__', 'web', 'home.png'));
    expect(await fresh.screenshot('home')).toBe(path.join(process.cwd(), '.harness', 'home.png'));
  });

  it('is HARNESS_ROOT when that is set', async () => {
    const root = path.join(os.tmpdir(), 'an-app');
    const {device: fresh, baselineFor} = await loadedWith(root);
    expect(baselineFor('windows', 'home')).toBe(path.join(root, 'device', '__screenshots__', 'windows', 'home.png'));
    expect(await fresh.screenshot('home')).toBe(path.join(root, '.harness', 'home.png'));
  });
});

describe('device', () => {
  it('has every member a test calls, taking what it took', () => {
    const members: Record<string, number> = {ready: 0, open: 1, snapshot: 0, fullSnapshot: 0, screenshot: 1, type: 1, key: 1, waitFor: 1, close: 0};
    const actual = device as unknown as Record<string, unknown>;
    for (const [name, length] of Object.entries(members)) {
      expect(typeof actual[name], name).toBe('function');
      expect((actual[name] as (...args: unknown[]) => unknown).length, name).toBe(length);
    }
    expect(typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(device), 'platform')?.get).toBe('function');
  });

  it('says there is nothing to drive, and what is missing', async () => {
    drive(stub({available: async () => ({ready: false, reason: 'playwright-core is not installed; add it to this project'})}));
    await expect(device.open('/')).rejects.toThrow(failure('DRIVER_UNAVAILABLE', `no ${device.platform} device to drive: playwright-core is not installed; add it to this project`));
  });

  it('says what it waited for, how long, and how big the tree was', async () => {
    drive(stub());
    await expect(device.waitFor(by.label('X'), {timeout: 10, interval: 1})).rejects.toThrow(failure('LOCATOR_NOT_FOUND', 'label="X" never appeared within 10 ms; the tree has 0 nodes'));
  });

  it('waits ten seconds unless told otherwise', async () => {
    vi.useFakeTimers();
    drive(stub());
    const waiting = expect(device.waitFor(by.testID('save'))).rejects.toThrow(failure('LOCATOR_NOT_FOUND', 'testId="save" never appeared within 10000 ms; the tree has 0 nodes'));
    await vi.advanceTimersByTimeAsync(10_400);
    await waiting;
  });

  it('finds what it waits for, from the whole tree', async () => {
    const save: SnapshotNode = {ref: '@e2', role: 'button', name: 'Save', testId: 'save', depth: 1, interactive: true};
    const snapshot = vi.fn(async () => ({platform: 'web', nodes: [save]}));
    drive(stub({snapshot}));
    expect(await device.waitFor(by.testID('save'))).toBe(save);
    expect(snapshot).toHaveBeenLastCalledWith({interactive: false});
  });

  it('snapshots what can be acted on by default, and everything when asked', async () => {
    const snapshot = vi.fn(async () => ({platform: 'web', nodes: []}));
    drive(stub({snapshot}));
    await device.snapshot();
    expect(snapshot).toHaveBeenLastCalledWith({interactive: true});
    await device.fullSnapshot();
    expect(snapshot).toHaveBeenLastCalledWith({interactive: false});
  });

  it('passes a failed step on with its message, and its code or the one that fits', async () => {
    drive(stub({open: async () => ({ok: false, message: 'could not open /'})}));
    await expect(device.open('/')).rejects.toThrow(failure('APP_UNREACHABLE', 'could not open /'));
    await device.close();
    drive(stub({open: async () => failed('cannot open myapp://: no exe to launch (pass --target <exe>)', 'APP_UNREACHABLE')}));
    await expect(device.open('/')).rejects.toThrow(failure('APP_UNREACHABLE', 'cannot open myapp://: no exe to launch (pass --target <exe>)'));
    await device.close();
    drive(stub({type: async () => failed('typing failed: no window')}));
    await expect(device.type('hello')).rejects.toThrow(failure('ACTION_FAILED', 'typing failed: no window'));
  });

  it('answers skipped for a key the backend cannot send', async () => {
    drive(stub());
    expect(await device.key('ArrowDown')).toBe('skipped');
    await device.close();
    drive(stub({key: async () => ok('pressed ArrowDown')}));
    expect(await device.key('ArrowDown')).toBe('pressed');
    await device.close();
    drive(stub({key: async () => ({ok: true, skipped: true, message: 'keys are not something the android harness can do'})}));
    expect(await device.key('ArrowDown')).toBe('skipped');
    await device.close();
    drive(stub({key: async () => failed('PageDown is not a key the Windows harness knows how to send', 'UNSUPPORTED_CAPABILITY')}));
    await expect(device.key('PageDown')).rejects.toThrow(failure('UNSUPPORTED_CAPABILITY', 'PageDown is not a key the Windows harness knows how to send'));
  });

  it('makes one driver and keeps it until closed', async () => {
    const driver = drive(stub());
    await device.ready();
    await device.ready();
    expect(driverFor).toHaveBeenCalledTimes(1);
    expect(await device.ready()).toBe(driver);
  });
});

describe('element', () => {
  it('has every member a test calls, taking what it took', () => {
    const one = element(by.testID('save'));
    expect(one.selector).toStrictEqual({testId: 'save'});
    const members: Record<string, number> = {press: 0, fill: 1, node: 0, waitFor: 1};
    const actual = one as unknown as Record<string, unknown>;
    for (const [name, length] of Object.entries(members)) {
      expect(typeof actual[name], name).toBe('function');
      expect((actual[name] as (...args: unknown[]) => unknown).length, name).toBe(length);
    }
  });

  it('presses and fills through the driver, and passes a failure on with its code', async () => {
    const press = vi.fn(async (): Promise<StepResult> => ok('pressed'));
    const fill = vi.fn(async (): Promise<StepResult> => failed('nothing matches testId="name" on the page (3 nodes)', 'LOCATOR_NOT_FOUND'));
    drive(stub({press, fill}));
    await element(by.testID('save')).press();
    expect(press).toHaveBeenCalledWith({testId: 'save'});
    await expect(element(by.testID('name')).fill('Ada')).rejects.toThrow(failure('LOCATOR_NOT_FOUND', 'nothing matches testId="name" on the page (3 nodes)'));
    expect(fill).toHaveBeenCalledWith({testId: 'name'}, 'Ada');
  });

  it('is ACTION_FAILED when the driver did not say what kind of failure it was', async () => {
    drive(stub({press: async () => ({ok: false, message: 'press failed'})}));
    await expect(element(by.label('Save')).press()).rejects.toThrow(failure('ACTION_FAILED', 'press failed'));
  });

  it('reads its node from the whole tree, and nothing when it is not there', async () => {
    const save: SnapshotNode = {ref: '@e2', role: 'button', name: 'Save', depth: 1, interactive: true};
    drive(stub({snapshot: async () => ({platform: 'web', nodes: [save]})}));
    expect(await element(by.label('Save')).node()).toBe(save);
    expect(await element(by.label('Cancel')).node()).toBeUndefined();
  });

  it('is told apart from any other error', async () => {
    drive(stub({press: async () => failed('press failed')}));
    const error = await element(by.label('Save')).press().catch((thrown: unknown) => thrown);
    expect(isHarnessError(error)).toBe(true);
    expect(isHarnessError(new Error('press failed'))).toBe(false);
  });
});

describe('the matchers', () => {
  const tree: Snapshot = {
    platform: 'web',
    nodes: [
      {ref: '@e1', role: 'button', name: 'Save', testId: 'save', depth: 1, interactive: true},
      {ref: '@e2', role: 'h1', name: 'Settings', depth: 1, interactive: false},
    ],
  };

  it('are all registered by the setup file', () => {
    const assertion = expect(tree) as unknown as Record<string, unknown>;
    for (const name of ['toHaveElement', 'toBeFullyLabelled', 'toSupportArrowNavigation', 'toMatchScreenshot']) expect(typeof assertion[name], name).toBe('function');
  });

  it('toHaveElement passes on a match, and says what the tree held on a miss', () => {
    expect(tree).toHaveElement(by.label('Save'));
    expect(() => expect(tree).toHaveElement(by.label('X'))).toThrow('expected an element matching label="X"; the tree has 2 nodes:\n  button "Save"\n  h1 "Settings"');
    expect(() => expect(tree).not.toHaveElement(by.label('Save'))).toThrow('expected no element matching label="Save", found @e1 button "Save"');
  });
});

describe('deviceConfig', () => {
  it('with no options is exactly the config a consumer has today', () => {
    expect(deviceConfig()).toStrictEqual({
      resolve: {alias: selfAliases()},
      test: {
        name: 'device',
        globals: true,
        environment: 'node',
        include: ['device/**/*.test.ts'],
        setupFiles: [file('device/matchers.ts')],
        testTimeout: 120_000,
        hookTimeout: 120_000,
        fileParallelism: false,
        pool: 'forks',
        maxWorkers: 1,
      },
    });
  });

  it('takes the test files and one timeout for tests and hooks', () => {
    expect(deviceConfig({include: ['x/**'], timeout: 5})).toStrictEqual({
      resolve: {alias: selfAliases()},
      test: {
        name: 'device',
        globals: true,
        environment: 'node',
        include: ['x/**'],
        setupFiles: [file('device/matchers.ts')],
        testTimeout: 5,
        hookTimeout: 5,
        fileParallelism: false,
        pool: 'forks',
        maxWorkers: 1,
      },
    });
  });
});

describe('expo-harness', () => {
  it('has the steps it had, each taking what it took', () => {
    expect(STEP_ARGUMENTS).toMatchObject({open: 1, snapshot: 0, tree: 0, press: 1, tap: 2, fill: 2, type: 1, screenshot: 1, raise: 0, wait: 1, idle: 0, bench: 0});
    expect(OPTIONAL_ARGUMENT.has('snapshot')).toBe(true);
    expect(OPTIONAL_ARGUMENT.has('bench')).toBe(true);
  });

  it('reads the options it read, in both spellings', () => {
    expect(parse(['-p', 'web', '--url', 'http://localhost:8081', '--scheme', 'myapp', '--target', 'MyApp', '--out', 'shots', '--force', '-i'])).toMatchObject({
      platform: 'web',
      url: 'http://localhost:8081',
      scheme: 'myapp',
      target: 'MyApp',
      out: 'shots',
      force: true,
      interactive: true,
    });
    expect(parse(['--platform', 'ios', '--interactive'])).toMatchObject({platform: 'ios', interactive: true});
    expect(parse(['--iterations', '50', '--field', 'testID=search', '--json'])).toMatchObject({iterations: '50', field: 'testID=search', json: true});
    expect(parse([])).toMatchObject({out: '.harness', force: false, interactive: false, json: false});
    expect(parse(['-h']).command).toBe('help');
    expect(parse(['--help']).command).toBe('help');
    expect(parse(['doctor']).command).toBe('doctor');
  });

  it('says the same two things about a command line it cannot run', () => {
    expect(() => parse(['jump'])).toThrow(failure('INVALID_ARGUMENT', 'jump is not a step; try --help'));
    expect(() => parse(['tap', '10'])).toThrow(failure('INVALID_ARGUMENT', 'tap takes 2 arguments'));
  });

  it('undoes what Git Bash does to a route', () => {
    const gitBash = {...process.env, MSYSTEM: 'MINGW64', EXEPATH: 'C:/Program Files/Git/bin'};
    expect(unmangleRoute('C:/Program Files/Git/detail', gitBash)).toBe('/detail');
    expect(unmangleRoute('C:/Program Files/Git/detail', {...gitBash, MSYSTEM: undefined})).toBe('C:/Program Files/Git/detail');
  });
});

describe('the types a consumer compiled against', () => {
  it('keep their shapes', () => {
    expectTypeOf(device.platform).toEqualTypeOf<'web' | 'windows' | 'android' | 'ios'>();
    expectTypeOf(device.open).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(device.open).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(device.snapshot).parameters.toEqualTypeOf<[options?: {interactive?: boolean}]>();
    expectTypeOf(device.snapshot).returns.toEqualTypeOf<Promise<Snapshot>>();
    expectTypeOf(device.fullSnapshot).returns.toEqualTypeOf<Promise<Snapshot>>();
    expectTypeOf(device.screenshot).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(device.screenshot).returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf(device.type).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(device.key).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(device.key).returns.toEqualTypeOf<Promise<'pressed' | 'skipped'>>();
    expectTypeOf(device.waitFor).parameters.toExtend<[Selector, ...unknown[]]>();
    expectTypeOf<NonNullable<Parameters<typeof device.waitFor>[1]>>().toMatchObjectType<{timeout?: number; interval?: number}>();
    expectTypeOf(device.waitFor).returns.toEqualTypeOf<Promise<SnapshotNode>>();
    expectTypeOf(device.close).returns.toEqualTypeOf<Promise<void>>();

    expectTypeOf(element).parameters.toEqualTypeOf<[Selector]>();
    const one = element(by.label('Save'));
    expectTypeOf(one.selector).toEqualTypeOf<Selector>();
    expectTypeOf(one.press).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(one.fill).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(one.node).returns.toEqualTypeOf<Promise<SnapshotNode | undefined>>();
    expectTypeOf<NonNullable<Parameters<typeof one.waitFor>[0]>>().toMatchObjectType<{timeout?: number}>();
    expectTypeOf(one.waitFor).returns.toEqualTypeOf<Promise<SnapshotNode>>();

    expectTypeOf<Selector>().toEqualTypeOf<{ref?: string; testId?: string; label?: string; role?: string; contains?: string}>();
    expectTypeOf<Plain<SnapshotNode>>().toMatchObjectType<{
      ref: string;
      role: string;
      name: string;
      testId?: string;
      depth: number;
      interactive: boolean;
      focused?: boolean;
      focusable?: boolean;
      enabled?: boolean;
      offscreen?: boolean;
      help?: string | null;
      inSet?: string | null;
      heading?: number | null;
      live?: string | null;
      status?: string | null;
      dialog?: boolean | null;
      bounds?: {x: number; y: number; width: number; height: number} | null;
    }>();
    expectTypeOf<Plain<Snapshot>>().toMatchObjectType<{platform: string; source?: string; nodes: SnapshotNode[]}>();
    expectTypeOf<Plain<DeviceConfig>>().toMatchObjectType<{platform: 'web' | 'windows' | 'android' | 'ios'; url?: string; scheme?: string; target?: string}>();

    expectTypeOf<Parameters<Assertion['toHaveElement']>>().toEqualTypeOf<[selector: Selector]>();
    expectTypeOf<Parameters<Assertion['toBeFullyLabelled']>>().toEqualTypeOf<[]>();
    expectTypeOf<Parameters<Assertion['toSupportArrowNavigation']>>().toEqualTypeOf<[key?: string]>();
    expectTypeOf<Parameters<Assertion['toMatchScreenshot']>[0]>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Parameters<Assertion['toMatchScreenshot']>[1]>>().toMatchObjectType<{maxRatio?: number}>();

    expectTypeOf(deviceConfig).returns.toEqualTypeOf<ViteUserConfig>();
    expectTypeOf<NonNullable<Parameters<typeof deviceConfig>[0]>>().toMatchObjectType<{include?: string[]; timeout?: number}>();
    expectTypeOf<Parameters<typeof nodeProject>[0]>().toMatchObjectType<{name: string; include: string[]; root?: string; timeout?: number}>();
    expectTypeOf<Plain<ExpoProjectsOptions>>().toMatchObjectType<{root?: string; platforms?: Platform[]; include?: string[]; transformPackages?: string[]; timeout?: number}>();
  });
});
