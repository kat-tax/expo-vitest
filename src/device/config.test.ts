import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import type {HarnessConfig} from './config.ts';
import {configFromRun, currentHarness, currentRun, DEFAULTS, defineHarness, findHarnessFile, isCI, loadHarness, loadHarnessSync, poolSize, portOf, requiresDriver, resolveRun, runId, sameConfig, serialisable, setHarness, setRun, validate} from './config.ts';

const root = path.resolve('/project');
const at = (...parts: string[]) => path.join(root, ...parts);
/** An environment of just these variables. */
const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;

/** The example the docs give, every key in use. */
const full = defineHarness({
  app: {
    web: {url: 'http://localhost:8081', command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']}, readyUrl: 'http://localhost:8081', storageState: '.harness/signed-in.json'},
    windows: {target: 'windows/x64/Release/MyApp.exe', scheme: 'myapp', launchArguments: [], stateDir: 'windows/state'},
    android: {bundleId: 'com.example.app', scheme: 'myapp', appPath: 'android/app-release.apk', permissions: {camera: 'grant', notifications: 'deny', location: 'reset'}},
    ios: {bundleId: 'com.example.app', scheme: 'myapp', device: 'iPhone 17', launchArguments: ['--initialUrl', 'http://localhost:8081'], identity: 'example'},
  },
  assertionTimeout: 5_000,
  stable: 1_000,
  settle: 150,
  transition: false,
  statusBar: 'real',
  actionTimeout: 30_000,
  video: 'retain-on-failure',
});

/** The message a config fails with. */
function failure(value: unknown): string {
  try {
    validate(value);
  } catch (error) {
    expect(error).toMatchObject({code: 'INVALID_CONFIG'});
    return (error as Error).message;
  }
  throw new Error('it passed');
}

describe('defineHarness', () => {
  it('hands back what it is given, typed', () => {
    const config = {assertionTimeout: 1};
    expect(defineHarness(config)).toBe(config);
  });
});

describe('finding the file', () => {
  const only = (...names: string[]) => (file: string) => names.map(name => at(name)).includes(file);

  it('takes the first of the four names at the root', () => {
    expect(findHarnessFile(root, undefined, only('harness.config.mts', 'harness.config.ts'))).toBe(at('harness.config.ts'));
    expect(findHarnessFile(root, undefined, only('harness.config.mjs', 'harness.config.js'))).toBe(at('harness.config.js'));
    expect(findHarnessFile(root, undefined, only('harness.config.mjs'))).toBe(at('harness.config.mjs'));
  });

  it('is none where there is none, so the environment and the defaults are all there is', () => {
    expect(findHarnessFile(root, undefined, only())).toBeNull();
  });

  it('takes the one named from the root, and fails where it is not', () => {
    expect(findHarnessFile(root, 'e2e/harness.ts', only(path.join('e2e', 'harness.ts')))).toBe(at('e2e', 'harness.ts'));
    expect(() => findHarnessFile(root, 'gone.ts', only('harness.config.ts'))).toThrow(expect.objectContaining({code: 'INVALID_CONFIG', message: `there is no harness config at ${at('gone.ts')}`}));
  });

  it('looks on disk unless told otherwise', () => {
    expect(findHarnessFile(path.resolve(import.meta.dirname, 'nothing-here'))).toBeNull();
  });
});

describe('loading the file', () => {
  it('loads nothing without a file', async () => {
    const load = vi.fn();
    await expect(loadHarness(null, load)).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("checks the file's default export", async () => {
    await expect(loadHarness(at('harness.config.ts'), async () => ({default: full}))).resolves.toBe(full);
    await expect(loadHarness(at('harness.config.mjs'), async () => ({}))).rejects.toThrow('harness.config.mjs: the default export is undefined; it takes an object');
  });
});

describe('checking it', () => {
  it('takes every key the docs give', () => {
    expect(validate(full)).toBe(full);
    expect(validate({})).toEqual({});
    expect(validate({app: {web: undefined, windows: {url: undefined}}, settle: undefined})).toBeTruthy();
  });

  it('takes a device on iOS and Android that a provider hosts, with the flags its connect takes', () => {
    expect(validate({app: {android: {device: {provider: 'limrun'}}}})).toBeTruthy();
    expect(validate({app: {ios: {device: {provider: 'browserstack', options: {device: 'iPhone 16', 'provider-os-version': '18', 'provider-no-resign-app': true}}}}})).toBeTruthy();
    const takes = "a device's name, or a hosted device: {provider, options}, its options agent-device's connect flags without their dashes, each a string or true";
    expect(failure({app: {android: {device: {provider: ''}}}})).toBe(`harness.config.ts: app.android.device is an object; it takes ${takes}`);
    expect(failure({app: {android: {device: {name: 'Pixel'}}}})).toBe(`harness.config.ts: app.android.device is an object; it takes ${takes}`);
    expect(failure({app: {android: {device: {provider: 'limrun', region: 'eu'}}}})).toBe(`harness.config.ts: app.android.device is an object; it takes ${takes}`);
    expect(failure({app: {android: {device: {provider: 'limrun', options: {'--region': 'eu'}}}}})).toBe(`harness.config.ts: app.android.device is an object; it takes ${takes}`);
    expect(failure({app: {android: {device: {provider: 'limrun', options: {retries: 2}}}}})).toBe(`harness.config.ts: app.android.device is an object; it takes ${takes}`);
    expect(failure({app: {android: {device: {provider: 'limrun', options: 'eu'}}}})).toBe(`harness.config.ts: app.android.device is an object; it takes ${takes}`);
    expect(failure({app: {android: {device: 5}}})).toBe(`harness.config.ts: app.android.device is 5; it takes ${takes}`);
    expect(failure({app: {web: {device: {provider: 'limrun'}}}})).toBe('harness.config.ts: app.web.device is a hosted device, which is for android and ios');
  });

  it('takes a pool of devices on iOS and Android, and of browsers on web', () => {
    expect(validate({app: {android: {devices: ['Pixel_8', 'Pixel_9']}, ios: {devices: ['iPhone 17']}, web: {workers: 3}}, poolTimeout: 90_000})).toBeTruthy();
    expect(failure({app: {android: {devices: []}}})).toBe("harness.config.ts: app.android.devices is a list; it takes a list of devices' names, one at least");
    expect(failure({app: {android: {devices: ['Pixel_8', '']}}})).toBe("harness.config.ts: app.android.devices is a list; it takes a list of devices' names, one at least");
    expect(failure({app: {web: {workers: 0}}})).toBe('harness.config.ts: app.web.workers is 0; it takes a whole number, 1 or more');
    expect(failure({app: {web: {workers: 1.5}}})).toBe('harness.config.ts: app.web.workers is 1.5; it takes a whole number, 1 or more');
    expect(failure({app: {web: {devices: ['a']}}})).toBe('harness.config.ts: app.web.devices is a pool of devices, which is for android and ios; web takes workers');
    expect(failure({app: {android: {workers: 2}}})).toBe("harness.config.ts: app.android.workers is for web; a device's pool is its devices");
    expect(failure({app: {android: {devices: ['a'], device: 'b'}}})).toBe('harness.config.ts: app.android names a pool in devices and one device in device; give one or the other');
    expect(failure({app: {ios: {devices: ['a'], target: 'b'}}})).toBe('harness.config.ts: app.ios names a pool in devices and one device in target; give one or the other');
    expect(failure({poolTimeout: -1})).toBe('harness.config.ts: poolTimeout is -1; it takes a number of ms, 0 or more');
  });

  it('names a key it does not take, and what it takes', () => {
    expect(failure({timeout: 5})).toBe('harness.config.ts: timeout is not something a harness config takes here; it takes app, assertionTimeout, stable, settle, transition, statusBar, actionTimeout, video, poolTimeout, agents, secrets, cache');
    expect(failure({app: {macos: {}}})).toBe('harness.config.ts: app.macos is not something a harness config takes here; it takes web, windows, android, ios');
    expect(failure({app: {web: {port: 1}}})).toMatch(/^harness\.config\.ts: app\.web\.port is not something .* it takes url, target, device,/);
    expect(failure({app: {web: {command: {executable: 'npx', shell: true}}}})).toMatch(/^harness\.config\.ts: app\.web\.command\.shell is not something/);
  });

  it("takes the agent's keys at the root, checked by the agent, and tools only within an agent", () => {
    expect(validate({agents: {default: {maxSteps: 10}}, secrets: {ADA_PASSWORD: 'correct horse'}, cache: 'off'})).toBeTruthy();
    expect(failure({agents: {default: {maxSteps: 0}}})).toBe('harness.config.ts: agents.default.maxSteps is 0; it takes a whole number from 1 to 100');
    expect(failure({tools: []})).toMatch(/^harness\.config\.ts: tools is not something a harness config takes here; it takes app, /);
    expect(failure({app: {web: {cache: 'off'}}})).toMatch(/^harness\.config\.ts: app\.web\.cache is not something/);
  });

  it('names a value of the wrong kind, and the kind it takes', () => {
    expect(failure(null)).toBe('harness.config.ts: the default export is null; it takes an object');
    expect(failure([])).toBe('harness.config.ts: the default export is a list; it takes an object');
    expect(failure({app: 'web'})).toBe('harness.config.ts: app is "web"; it takes an object');
    expect(failure({app: {web: () => {}}})).toBe('harness.config.ts: app.web is a function; it takes an object');
    expect(failure({assertionTimeout: -1})).toBe('harness.config.ts: assertionTimeout is -1; it takes a number of ms, 0 or more');
    expect(failure({stable: Number.NaN})).toBe('harness.config.ts: stable is NaN; it takes a number of ms, 0 or more');
    expect(failure({settle: true})).toBe('harness.config.ts: settle is true; it takes a number of ms, 0 or more');
    expect(failure({statusBar: 'clean'})).toBe('harness.config.ts: statusBar is "clean"; it takes \'fixed\' or \'real\'');
    expect(failure({app: {web: {url: 8081}}})).toBe('harness.config.ts: app.web.url is 8081; it takes a string');
    expect(failure({app: {ios: {launchArguments: '--a'}}})).toBe('harness.config.ts: app.ios.launchArguments is "--a"; it takes a list of strings');
    expect(failure({app: {ios: {launchArguments: [1]}}})).toBe('harness.config.ts: app.ios.launchArguments is a list; it takes a list of strings');
    expect(failure({app: {android: {permissions: {camera: 'allow'}}}})).toBe("harness.config.ts: app.android.permissions is an object; it takes an object of 'grant', 'deny' or 'reset'");
    expect(failure({app: {android: {permissions: ['camera']}}})).toBe("harness.config.ts: app.android.permissions is a list; it takes an object of 'grant', 'deny' or 'reset'");
  });

  it("checks a command's own keys, and that it has an executable", () => {
    expect(failure({app: {web: {command: 'npx expo start'}}})).toBe('harness.config.ts: app.web.command is "npx expo start"; it takes an object');
    expect(failure({app: {web: {command: {}}}})).toBe('harness.config.ts: app.web.command needs an executable');
    expect(failure({app: {web: {command: {executable: 'npx', env: {PORT: 8081}}}}})).toBe('harness.config.ts: app.web.command.env is an object; it takes an object of strings');
    expect(failure({app: {web: {command: {executable: 'npx', log: 1}}}})).toBe('harness.config.ts: app.web.command.log is 1; it takes a path, or false');
    expect(failure({app: {web: {command: {executable: 'npx', reuseExisting: 'yes'}}}})).toBe('harness.config.ts: app.web.command.reuseExisting is "yes"; it takes true or false');
    expect(validate({app: {web: {command: {executable: 'npx', log: false, reuseExisting: false, env: {}}}}})).toBeTruthy();
  });

  it('names the file it read', () => {
    expect(() => validate({timeout: 5}, 'harness.config.mjs')).toThrow(/^harness\.config\.mjs: timeout/);
  });
});

describe('what a run goes by', () => {
  it('is the defaults without a file or an environment', () => {
    expect(resolveRun('web', null, env(), root)).toEqual({
      platform: 'web',
      url: 'http://localhost:8081',
      identity: 'http://localhost:8081',
      launchArguments: [],
      permissions: {},
      assertionTimeout: 5000,
      stable: 1000,
      settle: 150,
      transition: 500,
      statusBar: 'fixed',
      actionTimeout: 30_000,
      video: 'off',
      poolTimeout: 60_000,
    });
    expect(resolveRun('android', null, env(), root)).toEqual({platform: 'android', launchArguments: [], permissions: {}, assertionTimeout: 5000, stable: 1000, settle: 150, transition: 500, statusBar: 'fixed', actionTimeout: 30_000, video: 'off', poolTimeout: 60_000});
  });

  it("is the defaults the device layer already keeps", () => {
    expect(DEFAULTS).toMatchObject({assertionTimeout: 5000, stable: 1000, settle: 150, transition: 500, startupTimeout: 60_000, shutdownTimeout: 10_000});
  });

  it('runs on a hosted device where nothing names one of this machine\'s', () => {
    const hosted = {provider: 'limrun', options: {'provider-os-version': '15'}};
    const run = resolveRun('android', {app: {android: {device: hosted, bundleId: 'com.example.app'}}}, env(), root);
    expect(run).toMatchObject({hosted, bundleId: 'com.example.app'});
    expect(run).not.toHaveProperty('target');
    expect(resolveRun('android', {app: {android: {device: hosted}}}, env({HARNESS_TARGET: 'emulator-5554'}), root)).toMatchObject({target: 'emulator-5554'});
    expect(resolveRun('android', {app: {android: {device: hosted}}}, env({HARNESS_TARGET: 'emulator-5554'}), root)).not.toHaveProperty('hosted');
    expect(resolveRun('android', {app: {android: {device: hosted, target: 'Pixel_9'}}}, env(), root)).not.toHaveProperty('hosted');
    expect(resolveRun('android', {app: {android: {device: 'Pixel_9'}}}, env(), root)).toMatchObject({target: 'Pixel_9'});
  });

  it('shares a pool where nothing names one device, and waits for it as long as the file says', () => {
    const pooled = {app: {android: {devices: ['Pixel_8', 'Pixel_9']}, web: {workers: 3}}, poolTimeout: 90_000};
    expect(resolveRun('android', pooled, env(), root)).toMatchObject({devices: ['Pixel_8', 'Pixel_9'], poolTimeout: 90_000});
    expect(resolveRun('android', pooled, env({HARNESS_TARGET: 'emulator-5554'}), root)).not.toHaveProperty('devices');
    expect(resolveRun('web', pooled, env(), root)).toMatchObject({workers: 3, poolTimeout: 90_000});
    expect(resolveRun('web', null, env(), root)).not.toHaveProperty('workers');
  });

  it('is loaded while a Vitest config is built, or not at all where it will not load so', () => {
    expect(loadHarnessSync(null)).toBeNull();
    expect(loadHarnessSync('/app/harness.config.ts', () => ({default: {poolTimeout: 5}}))).toEqual({poolTimeout: 5});
    expect(loadHarnessSync('/app/harness.config.cjs', () => ({app: {web: {workers: 2}}}))).toEqual({app: {web: {workers: 2}}});
    expect(loadHarnessSync('/app/harness.config.ts', () => null)).toEqual(null);
    expect(
      loadHarnessSync('/app/harness.config.ts', () => {
        throw new Error('top-level await');
      }),
    ).toBeNull();
    expect(loadHarnessSync('/app/harness.config.ts', () => ({default: {timeout: 5}}))).toBeNull();
  });

  it('runs as many files at once as the pool has devices, or web workers, and one otherwise', () => {
    const pooled = {app: {android: {devices: ['a', 'b']}, ios: {devices: ['c']}, web: {workers: 3}, windows: {target: 'App.exe'}}};
    expect(['android', 'ios', 'web', 'windows'].map(platform => poolSize(platform as 'web', pooled, env()))).toEqual([2, 1, 3, 1]);
    expect(poolSize('android', pooled, env({HARNESS_TARGET: 'emulator-5554'}))).toBe(1);
    expect(poolSize('web', pooled, env({HARNESS_TARGET: 'x'}))).toBe(3);
    expect(poolSize('android', null, env())).toBe(1);
    expect(poolSize('web', null, env())).toBe(1);
  });

  it('takes the file over the defaults', () => {
    const run = resolveRun('android', full, env(), root);
    expect(run).toEqual({
      platform: 'android',
      scheme: 'myapp',
      bundleId: 'com.example.app',
      appPath: at('android', 'app-release.apk'),
      identity: 'com.example.app',
      launchArguments: [],
      permissions: {camera: 'grant', notifications: 'deny', location: 'reset'},
      assertionTimeout: 5000,
      stable: 1000,
      settle: 150,
      transition: 0,
      statusBar: 'real',
      actionTimeout: 30_000,
      video: 'retain-on-failure',
      poolTimeout: 60_000,
    });
    expect(resolveRun('windows', full, env(), root)).toMatchObject({target: 'windows/x64/Release/MyApp.exe', stateDir: at('windows', 'state')});
    expect(resolveRun('web', full, env(), root)).toMatchObject({storageState: at('.harness', 'signed-in.json')});
    expect(resolveRun('windows', full, env(), root)).not.toHaveProperty('identity');
    expect(resolveRun('ios', full, env(), root)).toMatchObject({target: 'iPhone 17', identity: 'example', launchArguments: ['--initialUrl', 'http://localhost:8081']});
  });

  it('takes the environment over the file, a row at a time', () => {
    const file: HarnessConfig = {
      app: {android: {url: 'http://file:1', target: 'file-target', device: 'file-device', scheme: 'file'}},
      assertionTimeout: 1,
      stable: 2,
      settle: 3,
      transition: 4,
    };
    const environment = env({
      HARNESS_URL: 'http://env:2',
      HARNESS_TARGET: 'env-target',
      HARNESS_SCHEME: 'env',
      HARNESS_ASSERTION_TIMEOUT: '10',
      HARNESS_STABLE: '20',
      HARNESS_SETTLE: 'false',
      HARNESS_TRANSITION: '40',
    });
    expect(resolveRun('android', file, environment, root)).toMatchObject({url: 'http://env:2', target: 'env-target', scheme: 'env', assertionTimeout: 10, stable: 20, settle: 0, transition: 40});
    expect(resolveRun('android', file, env(), root)).toMatchObject({url: 'http://file:1', target: 'file-target', scheme: 'file', assertionTimeout: 1, stable: 2, settle: 3, transition: 4});
  });

  it('records video as the environment says, else the file, else not at all', () => {
    expect(resolveRun('web', {video: 'on'}, env(), root).video).toBe('on');
    expect(resolveRun('web', {video: 'on'}, env({HARNESS_VIDEO: 'retain-on-failure'}), root).video).toBe('retain-on-failure');
    expect(resolveRun('web', {video: 'on'}, env({HARNESS_VIDEO: 'sometimes'}), root).video).toBe('on');
    expect(resolveRun('web', null, env(), root).video).toBe('off');
    expect(failure({video: 'always'})).toBe("harness.config.ts: video is \"always\"; it takes 'on', 'retain-on-failure' or 'off'");
  });

  it('passes over an environment value that is not a count of ms', () => {
    const environment = env({HARNESS_ASSERTION_TIMEOUT: 'soon', HARNESS_STABLE: '-1', HARNESS_SETTLE: '', HARNESS_TRANSITION: 'Infinity'});
    expect(resolveRun('web', {assertionTimeout: 7, settle: false}, environment, root)).toMatchObject({assertionTimeout: 7, stable: 1000, settle: 0, transition: 500});
  });

  it('takes a device as the target where there is no target', () => {
    expect(resolveRun('ios', {app: {ios: {device: 'iPhone 17'}}}, env(), root)).toMatchObject({target: 'iPhone 17'});
    expect(resolveRun('ios', {app: {ios: {device: 'iPhone 17', target: 'iPad'}}}, env(), root)).toMatchObject({target: 'iPad'});
  });
});

describe('the command', () => {
  const command = (platform: 'web' | 'android', app: object, environment = env()) => resolveRun(platform, {app: {[platform]: app}}, environment, root);

  it('fills in what it was not given, and puts its port in', () => {
    expect(command('web', {command: {executable: 'npx', args: ['expo', 'start', '--port', '{port}']}})).toMatchObject({
      readyUrl: 'http://localhost:8081',
      command: {
        executable: 'npx',
        args: ['expo', 'start', '--port', '8081'],
        cwd: root,
        env: {},
        startupTimeout: 60_000,
        shutdownTimeout: 10_000,
        log: at('.harness', 'app-web.log'),
        reuseExisting: true,
      },
    });
  });

  it('keeps what it was given, from the root', () => {
    const given = {executable: 'node', cwd: 'server', env: {PORT: '1'}, startupTimeout: 1, shutdownTimeout: 2, log: 'logs/web.txt', reuseExisting: false};
    expect(command('web', {url: 'https://app.test', readyUrl: 'https://app.test/status', command: given})).toMatchObject({
      readyUrl: 'https://app.test/status',
      command: {...given, args: [], cwd: at('server'), log: at('logs', 'web.txt')},
    });
    expect(command('web', {command: {executable: 'node', log: false}})).toMatchObject({command: {log: false}});
  });

  it('does not use one already running in CI unless told to', () => {
    expect(command('web', {command: {executable: 'npx'}}, env({CI: 'true'}))).toMatchObject({command: {reuseExisting: false}});
    expect(command('web', {command: {executable: 'npx'}}, env({CI: 'false'}))).toMatchObject({command: {reuseExisting: true}});
    expect(command('web', {command: {executable: 'npx', reuseExisting: true}}, env({CI: 'true'}))).toMatchObject({command: {reuseExisting: true}});
  });

  it('takes the port from the environment url when that is the one', () => {
    expect(command('web', {command: {executable: 'npx', args: ['{port}']}}, env({HARNESS_URL: 'http://localhost:9000'}))).toMatchObject({command: {args: ['9000']}, readyUrl: 'http://localhost:9000'});
  });

  it('fails without a url for its port, or for knowing it has started', () => {
    expect(() => command('android', {readyUrl: 'http://localhost:8081/status', command: {executable: 'npx', args: ['--port', '{port}']}})).toThrow(
      expect.objectContaining({code: 'INVALID_CONFIG', message: 'app.android.command.args has {port}, and there is no url on android to take it from'}),
    );
    expect(() => command('android', {command: {executable: 'npx', args: ['expo', 'start']}})).toThrow(
      expect.objectContaining({code: 'INVALID_CONFIG', message: 'app.android.command needs a readyUrl, or a url, to tell when it has started'}),
    );
    expect(command('android', {readyUrl: 'http://localhost:8081/status', command: {executable: 'npx', args: ['expo', 'start']}})).toMatchObject({
      readyUrl: 'http://localhost:8081/status',
      command: {args: ['expo', 'start']},
    });
  });

  it('is waited for at a ready url only when there is a command', () => {
    expect(resolveRun('web', {app: {web: {url: 'http://localhost:1'}}}, env(), root)).not.toHaveProperty('readyUrl');
  });
});

describe('a port', () => {
  it("is the url's, or its scheme's own", () => {
    expect(portOf('http://localhost:8081/status')).toBe('8081');
    expect(portOf('http://localhost')).toBe('80');
    expect(portOf('https://localhost')).toBe('443');
  });
});

describe('what crosses to the workers', () => {
  it('is the config less its functions, the same hash whatever order it was written in', () => {
    const one = serialisable({assertionTimeout: 1, app: {web: {url: 'u', launchArguments: ['a', 'b']}}});
    const two = serialisable({app: {web: {launchArguments: ['a', 'b'], url: 'u', target: undefined}}, assertionTimeout: 1, ...({later: () => 1} as object)});
    expect(one).toEqual(two);
    expect(one.value).toEqual({app: {web: {launchArguments: ['a', 'b'], url: 'u'}}, assertionTimeout: 1});
    expect(Object.keys(one.value as object)).toEqual(['app', 'assertionTimeout']);
    expect(serialisable({app: {web: {launchArguments: ['b', 'a']}}}).hash).not.toBe(serialisable({app: {web: {launchArguments: ['a', 'b']}}}).hash);
  });

  it("names an instance of a class rather than walking it, as a model's client or a tool's schema can be, which may hold a key or itself", () => {
    class Client {
      apiKey = 'sk-ant-secret';
      self: Client = this;
    }
    const model = {id: 'claude-opus-5-5', client: new Client(), complete: () => Promise.resolve()};
    const plain = Object.assign(Object.create(null) as object, {mode: 'off'});
    const {value} = serialisable({agents: {default: {model: model as never}}, cache: plain as never});
    expect(value).toEqual({agents: {default: {model: {client: '[Client]', id: 'claude-opus-5-5'}}}, cache: {mode: 'off'}});
    expect(serialisable({agents: {default: {model: {...model, client: Object.create(Object.create(null) as object) as never} as never}}}).value).toEqual({agents: {default: {model: {client: '[object]', id: 'claude-opus-5-5'}}}});
  });

  it('is null with no file, which hashes too', () => {
    expect(serialisable(null)).toEqual({value: null, hash: expect.stringMatching(/^[0-9a-f]{40}$/)});
  });

  it('fails a worker whose load differs from the run', () => {
    const {hash} = serialisable(full);
    expect(() => sameConfig(full, hash, at('harness.config.ts'))).not.toThrow();
    expect(() => sameConfig({...full, stable: 2}, hash, at('harness.config.ts'))).toThrow(
      expect.objectContaining({code: 'INVALID_CONFIG', message: `${at('harness.config.ts')} changed after the run started; start the run again`}),
    );
    expect(() => sameConfig(full, serialisable(null).hash, null)).toThrow('the harness config changed after the run started; start the run again');
  });
});

describe('CI and a platform that cannot be driven', () => {
  it('is CI where CI is set, and not where it says no', () => {
    expect([isCI(env({CI: 'true'})), isCI(env({CI: '1'})), isCI(env({CI: 'woodpecker'}))]).toEqual([true, true, true]);
    expect([isCI(env()), isCI(env({CI: ''})), isCI(env({CI: '0'})), isCI(env({CI: 'false'}))]).toEqual([false, false, false, false]);
  });

  it('fails under HARNESS_REQUIRE, or in CI unless HARNESS_REQUIRE says no', () => {
    expect(requiresDriver(env())).toBe(false);
    expect(requiresDriver(env({HARNESS_REQUIRE: '1'}))).toBe(true);
    expect(requiresDriver(env({CI: 'true'}))).toBe(true);
    expect(requiresDriver(env({CI: 'true', HARNESS_REQUIRE: '0'}))).toBe(false);
    expect(requiresDriver(env({CI: 'true', HARNESS_REQUIRE: 'false'}))).toBe(false);
    expect(requiresDriver(env({CI: 'true', HARNESS_REQUIRE: ''}))).toBe(true);
  });
});

describe('the run a worker hands the device', () => {
  it('is kept on the global object, one per worker', () => {
    const store = {};
    expect(currentRun(store)).toBeUndefined();
    const run = resolveRun('web', null, env(), root);
    setRun(run, store);
    expect(currentRun(store)).toBe(run);
    expect(currentRun({})).toBeUndefined();
  });

  it("is on the global object unless told otherwise", () => {
    const before = currentRun();
    const run = resolveRun('android', null, env(), root);
    setRun(run);
    expect(currentRun(globalThis)).toBe(run);
    setRun(before as typeof run);
  });

  it("becomes the device's config: the app and the waits, and the environment's force", () => {
    const run = resolveRun('android', {app: {android: {target: 'Pixel', scheme: 'myapp', url: 'http://localhost:8081'}}, settle: false}, env(), root);
    expect(configFromRun(run, env({HARNESS_FORCE: '1'}))).toEqual({
      platform: 'android',
      url: 'http://localhost:8081',
      scheme: 'myapp',
      target: 'Pixel',
      force: true,
      settle: 0,
      transition: 500,
      assertionTimeout: 5000,
      stable: 1000,
      statusBar: 'fixed',
      actionTimeout: 30_000,
      video: 'off',
    });
    expect(configFromRun(resolveRun('ios', null, env(), root), env({HARNESS_FORCE: '0'}))).toEqual({platform: 'ios', settle: 150, transition: 500, assertionTimeout: 5000, stable: 1000, statusBar: 'fixed', actionTimeout: 30_000, video: 'off'});
    expect(configFromRun(resolveRun('ios', {actionTimeout: 5}, env(), root), env()).actionTimeout).toBe(5);
    expect(configFromRun(resolveRun('ios', {statusBar: 'real'}, env(), root), env()).statusBar).toBe('real');
  });

  it("carries the app, for its fresh launches and its state, and only what the file gave of it", () => {
    expect(configFromRun(resolveRun('android', full, env(), root), env()).app).toEqual({
      bundleId: 'com.example.app',
      appPath: at('android', 'app-release.apk'),
      permissions: {camera: 'grant', notifications: 'deny', location: 'reset'},
    });
    expect(configFromRun(resolveRun('ios', full, env(), root), env()).app).toEqual({bundleId: 'com.example.app', launchArguments: ['--initialUrl', 'http://localhost:8081']});
    expect(configFromRun(resolveRun('windows', full, env(), root), env()).app).toEqual({stateDir: at('windows', 'state')});
    expect(configFromRun(resolveRun('web', full, env(), root), env()).app).toEqual({storageState: at('.harness', 'signed-in.json')});
    expect(configFromRun(resolveRun('web', defineHarness({app: {web: {url: 'http://localhost:8081'}}}), env(), root), env())).not.toHaveProperty('app');
  });
});

describe("the run's id", () => {
  it('is made once, sorts by when the run began, and is safe in a file name', () => {
    const store = {};
    const id = runId(store, new Date('2026-10-15T07:31:02.345Z'), () => 'a1b2c3');
    expect(id).toBe('2026-10-15T07-31-02-345Z-a1b2c3');
    expect(runId(store, new Date('2027-01-01T00:00:00.000Z'), () => 'ffffff')).toBe(id);
    expect(runId({})).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}$/);
  });
});

describe("the config the agent reads", () => {
  it('is what the setup file loaded, kept on the store it is given, null for no file, and undefined before any', () => {
    const store = {};
    expect(currentHarness(store)).toBeUndefined();
    const config = {agents: {default: {}}};
    setHarness(config, store);
    expect(currentHarness(store)).toBe(config);
    setHarness(null, store);
    expect(currentHarness(store)).toBeNull();
  });
});
