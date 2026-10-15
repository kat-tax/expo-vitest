import fs from 'node:fs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {HarnessError} from '../harness/lib/errors.ts';
import {MASK} from '../harness/lib/image.ts';
import {decodePng, encodePng} from '../harness/lib/png.ts';
import {done, FakeDevice, hostOf, node, scratch, signIn} from './__fixtures__/device.ts';
import {ACTION_TIMEOUT, Hands} from './hands.ts';
import type {ActingHost, HandsOptions} from './hands.ts';
import {clearTaint, taint, tainted} from './policy.ts';
import {SecretStore, secret} from './secrets.ts';
import {stepSignal} from './step.ts';

const at = {step: 'act' as const, instruction: 'sign in as Ada'};

function setUp({device = new FakeDevice(), host: overrides, ...options}: Partial<Omit<HandsOptions, 'host'>> & {device?: FakeDevice; host?: Partial<ActingHost>} = {}) {
  const host = hostOf(device, overrides);
  const journal = host.journal as NonNullable<ActingHost['journal']>;
  const spent: number[] = [];
  const hands = new Hands({host, at, signal: new AbortController().signal, secrets: new SecretStore({ADA_PASSWORD: 'correct horse battery'}, {} as NodeJS.ProcessEnv), spend: () => spent.push(1), taintStore: {}, ...options});
  return {hands, device, journal, spent, host};
}

/** What a promise rejected with, as its code and message. */
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: HarnessError) => [error.code, error.message]);

describe('a look at the screen', () => {
  it("is the view under the step's refs, with the route, every secret hidden", async () => {
    const {hands, device} = setUp({host: {route: () => Promise.resolve('/sign-in')}});
    device.screen = signIn({email: 'correct horse battery'});
    expect(hands.seen).toBeNull();
    const seen = await hands.observe();
    expect(seen.view).toBe(
      ['route: /sign-in\nwindow: 400x800', '@e2  textbox  "Email"  value="<secret:ADA_PASSWORD>"\n@e3  textbox  "Password"  [secure]\n@e4  checkbox  "Remember me"  [unchecked]\n@e5  button  "Sign in"', '@e1  form  "Sign in"'].join('\n\n'),
    );
    expect([seen.route, seen.platformRef.get('@e5'), hands.seen]).toEqual(['/sign-in', '@e14', seen]);
    expect(hands.hide('it is correct horse battery')).toBe('it is <secret:ADA_PASSWORD>');
  });

  it('leaves out what does not fit, where the step says how much may', async () => {
    const {hands} = setUp({maxObservationBytes: 150});
    expect((await hands.observe()).view).toContain('more nodes left out, to fit');
  });
});

describe('an action', () => {
  it("presses the platform's node for the step's ref, spends an action, and answers what changed since the model looked", async () => {
    const {hands, device, journal, spent} = setUp();
    device.onPress = target => (JSON.stringify(target) === '{"ref":"@e14"}' ? signIn({signedIn: true}) : undefined);
    await hands.observe();
    const changes = await hands.tap('@e5');
    expect(device.calls).toEqual(['press {"ref":"@e14"}']);
    expect(spent).toEqual([1]);
    expect(changes).toContain('@e6  heading  "Welcome back"  h1');
    expect(journal.steps.map(step => [step.event, step.what, step.resolved, step.result])).toEqual([['press', 'agent: tap @e5', '@e14  button "Sign in"  at 20,240', 'ok']]);
    expect(hands.recorded).toEqual([{tool: 'tap', target: {kind: 'button', name: 'Sign in', testId: null, parent: ['form', 'Sign in']}, input: {}}]);
  });

  it('compares with the screen it was aimed on where the model had not looked, and reads one where it was aimed at nothing', async () => {
    const {hands, device} = setUp();
    expect(await hands.tap('@e5')).toBe('screen: unchanged');
    const fresh = setUp();
    expect(await fresh.hands.press('Enter')).toBe('screen: unchanged');
    expect(fresh.device.calls).toEqual(['key Enter']);
    expect(device.calls).toEqual(['press {"ref":"@e14"}']);
  });

  it('says where the app went, in the bytes the step allows', async () => {
    const routes = ['/sign-in', '/sign-in', '/home'];
    const {hands, device} = setUp({host: {route: () => Promise.resolve(routes.shift())}, maxObservationBytes: 150});
    device.onPress = () => signIn({signedIn: true});
    await hands.observe();
    expect(await hands.tap('@e5')).toBe(['route: /home', 'window: 400x800', '', '@e6  heading  "Welcome back"  h1'].join('\n'));
  });

  it('is LOCATOR_NOT_FOUND for a ref not on the screen now, and spends nothing', async () => {
    const {hands, spent} = setUp();
    expect(await failure(hands.tap('@e40'))).toEqual(['LOCATOR_NOT_FOUND', '@e40 is not on the screen now; observe to see what is']);
    expect(spent).toEqual([]);
  });

  it('works without a journal', async () => {
    const {hands, device} = setUp({host: {journal: undefined}});
    await hands.tap('@e5');
    expect(device.calls).toHaveLength(1);
  });

  it("is the driver's failure with its code, its message's secrets hidden, and UNSUPPORTED_CAPABILITY where it was skipped or has no such step", async () => {
    const failing = new FakeDevice({press: () => Promise.resolve({ok: false, code: 'NOT_ACTIONABLE', message: 'covered by correct horse battery'})});
    expect(await failure(setUp({device: failing}).hands.tap('@e5'))).toEqual(['NOT_ACTIONABLE', 'covered by <secret:ADA_PASSWORD>']);
    const plain = new FakeDevice({press: () => Promise.resolve({ok: false, message: 'no'})});
    expect((await failure(setUp({device: plain}).hands.tap('@e5')))?.[0]).toBe('ACTION_FAILED');
    const skipping = new FakeDevice({key: () => Promise.resolve({ok: true, skipped: true, message: 'no keys here'})});
    expect(await failure(setUp({device: skipping}).hands.press('Enter'))).toEqual(['UNSUPPORTED_CAPABILITY', 'no keys here']);
    const keyless = new FakeDevice({key: undefined});
    expect(await failure(setUp({device: keyless}).hands.press('Enter'))).toEqual(['UNSUPPORTED_CAPABILITY', 'press is not something the web harness can do']);
    const {hands, journal} = setUp({device: failing});
    await hands.tap('@e5').catch(() => undefined);
    expect(journal.steps[0]?.result).toBe('failed');
  });

  it('is what the driver threw, where it threw', async () => {
    const throwing = new FakeDevice({press: () => Promise.reject(new Error('the page crashed'))});
    await expect(setUp({device: throwing}).hands.tap('@e5')).rejects.toThrow('the page crashed');
  });

  it('is never sent once the actions are spent', async () => {
    const {hands, device} = setUp({
      spend: () => {
        throw new HarnessError('STEP_BUDGET_EXHAUSTED', 'it used its 25 actions');
      },
    });
    expect((await failure(hands.tap('@e5')))?.[0]).toBe('STEP_BUDGET_EXHAUSTED');
    expect(device.calls).toEqual([]);
  });

  it('is INVALID_ARGUMENT for a tool that is not one of the actions', async () => {
    expect(await failure(setUp().hands.perform('hover', undefined, {}))).toEqual(['INVALID_ARGUMENT', "hover is not one of the agent's actions"]);
  });
});

describe('the limit on an action', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('tells the model an action that did not finish in 15 s', async () => {
    const stuck = new FakeDevice({press: () => new Promise(() => undefined)});
    const pending = failure(setUp({device: stuck}).hands.tap('@e5'));
    await vi.advanceTimersByTimeAsync(ACTION_TIMEOUT);
    expect(await pending).toEqual(['ACTION_FAILED', 'tap @e5 did not finish in 15 s']);
  });

  it("ends with the step, where the step's signal aborts while it waits or before", async () => {
    const stuck = new FakeDevice({press: () => new Promise(() => undefined)});
    const step = stepSignal(at, 1000);
    const pending = failure(setUp({device: stuck, signal: step.signal}).hands.tap('@e5'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(['STEP_TIMEOUT', 'agent.act("sign in as Ada"): it ran past its timeout of 1000 ms']);
    expect((await failure(setUp({signal: AbortSignal.abort()}).hands.tap('@e5')))?.[0]).toBe('CANCELLED');
  });
});

describe('typing', () => {
  it('fills a field in place of what it holds, or presses it and types after, keeping a unique value as its slot', async () => {
    const {hands, device} = setUp({uniques: {email: 'ada+81@example.com'}});
    await hands.type('@e2', 'ada+81@example.com', true);
    await hands.type('@e2', ' and more', false);
    expect(device.calls).toEqual(['fill {"ref":"@e11"} "ada+81@example.com"', 'press {"ref":"@e11"}', 'type " and more"']);
    expect(hands.recorded.map(each => each.input)).toEqual([
      {text: '{{param:email}}', replace: true},
      {text: ' and more', replace: false},
    ]);
  });

  it('types nothing where the press before it failed', async () => {
    const device = new FakeDevice({press: () => Promise.resolve({ok: false, message: 'covered'})});
    await setUp({device}).hands.type('@e2', 'x', false).catch(() => undefined);
    expect(device.calls).toEqual([]);
  });

  it("hides a secret in the journal's account of what was typed", async () => {
    const {hands, journal} = setUp();
    await hands.type('@e2', 'correct horse battery', true);
    expect(journal.steps[0]?.what).toBe('agent: type @e2 "<secret:ADA_PASSWORD>"');
  });
});

describe('a secret typed', () => {
  const password = secret('ADA_PASSWORD');

  it('fills the password field with the value, taints the test, and keeps only the name', async () => {
    const taints = {};
    const {hands, device, journal} = setUp({stepSecrets: [password], taintStore: taints});
    await hands.typeSecret('@e3', 'ADA_PASSWORD');
    expect(device.calls).toEqual(['fill {"ref":"@e12"} "correct horse battery"']);
    expect(tainted(taints)).toBe(true);
    expect(journal.steps[0]?.what).toBe('agent: type_secret @e3 <secret:ADA_PASSWORD>');
    expect(hands.recorded[0]?.input).toEqual({secret: 'ADA_PASSWORD'});
  });

  it('is POLICY_DENIED for a secret not in the step, or a field the rules refuse', async () => {
    const {hands} = setUp({stepSecrets: [password]});
    expect(await failure(hands.typeSecret('@e3', 'OTHER_PASSWORD'))).toEqual(['POLICY_DENIED', "the secret OTHER_PASSWORD is not one of this step's params, and only those can be filled"]);
    expect(await failure(hands.typeSecret('@e2', 'ADA_PASSWORD'))).toEqual(['POLICY_DENIED', 'ADA_PASSWORD is a password, and @e2 is not a password field']);
    expect(await failure(setUp().hands.typeSecret('@e3', 'ADA_PASSWORD'))).toEqual(['POLICY_DENIED', "the secret ADA_PASSWORD is not one of this step's params, and only those can be filled"]);
  });

  it("learns a value a function answers, so the step's text hides it from then on", async () => {
    const token = secret('API_TOKEN');
    const secrets = new SecretStore({API_TOKEN: () => 'tok_live_123456'}, {} as NodeJS.ProcessEnv);
    const {hands, device} = setUp({secrets, stepSecrets: [token]});
    await hands.typeSecret('@e2', 'API_TOKEN');
    device.screen = signIn({email: 'tok_live_123456'});
    expect((await hands.observe()).view).toContain('value="<secret:API_TOKEN>"');
  });
});

describe('a check', () => {
  it('presses only where the control is not so already, and says where it was', async () => {
    const {hands, device, spent} = setUp();
    device.onPress = () => signIn({remember: true});
    expect(await hands.check('@e4', true)).toContain('~ @e4  checkbox  "Remember me"  [checked]');
    expect(await hands.check('@e4', true)).toBe('@e4 is checked already, so nothing was pressed');
    expect([device.calls.length, spent.length, hands.recorded.length]).toEqual([1, 1, 1]);
  });

  it('is NOT_ACTIONABLE for a control with no checked state, and ACTION_FAILED where the press did not take', async () => {
    const {hands, device} = setUp();
    expect(await failure(hands.check('@e5', true))).toEqual(['NOT_ACTIONABLE', '@e5 reports no checked state, so there is nothing to check']);
    expect(await failure(hands.check('@e4', true))).toEqual(['ACTION_FAILED', 'pressed @e4 to check it, and it is still unchecked']);
    device.screen = signIn({remember: true});
    device.onPress = () => ({...signIn(), nodes: signIn().nodes.map(each => (each.ref === '@e13' ? {...each, checked: 'mixed' as const} : each))});
    expect((await failure(hands.check('@e4', false)))?.[1]).toBe('pressed @e4 to uncheck it, and it is still mixed');
    device.onPress = () => signIn({signedIn: true});
    expect((await failure(hands.check('@e4', false)))?.[1]).toBe('pressed @e4 to uncheck it, and it is gone');
    expect(hands.recorded).toEqual([]);
  });
});

describe('scrolling', () => {
  it('draws a finger the other way across the screen, or a node, so down shows what is below', async () => {
    const {hands, device} = setUp();
    await hands.scroll('down');
    await hands.scroll('up', '@e5');
    expect(device.calls).toEqual(['swipe 200,600 200,200', 'swipe 70,250 70,270']);
    expect(hands.recorded.map(each => [each.tool, each.input, each.target?.name])).toEqual([
      ['scroll', {direction: 'down'}, undefined],
      ['scroll', {direction: 'up'}, 'Sign in'],
    ]);
  });

  it('takes the largest node for the screen where there is no viewport, and refuses what has no bounds', async () => {
    const {hands, device} = setUp();
    device.screen = {platform: 'android', nodes: [node('@e1', 'view', '', {bounds: {x: 0, y: 0, width: 100, height: 200}}), node('@e2', 'button', 'Go', {interactive: true, bounds: {x: 0, y: 0, width: 10, height: 10}})]};
    await hands.scroll('left');
    expect(device.calls).toEqual(['swipe 25,100 75,100']);
    device.screen = {platform: 'android', nodes: [node('@e1', 'button', 'Go', {interactive: true})]};
    expect(await failure(hands.scroll('down', '@e2'))).toEqual(['NOT_ACTIONABLE', '@e2 has no bounds to scroll across']);
    const bare = setUp();
    bare.device.screen = {platform: 'android', nodes: [node('@e1', 'button', 'Go', {interactive: true})]};
    expect((await failure(bare.hands.scroll('right')))?.[1]).toBe('the screen has no bounds to scroll across');
  });

  it("brings a node into view by its ref, up where it is above the screen, or by its text, below and then above", async () => {
    const {hands, device} = setUp();
    device.screen = {...signIn(), nodes: [...signIn().nodes, node('@e20', 'button', 'Terms', {interactive: true, bounds: {x: 0, y: -400, width: 50, height: 20}})]};
    await hands.scrollTo({ref: '@e6'});
    await hands.scrollTo({ref: '@e5'});
    await hands.scrollTo({text: 'Privacy'});
    expect(device.calls).toEqual(['scrollIntoView {"ref":"@e20"} up', 'scrollIntoView {"ref":"@e14"} down', 'scrollIntoView {"label":"Privacy"} down']);
    const below = new FakeDevice();
    below.driver.scrollIntoView = (target, options) => {
      below.calls.push(`scrollIntoView ${options?.direction}`);
      return Promise.resolve({ok: options?.direction === 'up', message: ''});
    };
    await setUp({device: below}).hands.scrollTo({text: 'Privacy'});
    expect(below.calls).toEqual(['scrollIntoView down', 'scrollIntoView up']);
    expect(await failure(hands.scrollTo({ref: null, text: null}))).toEqual(['INVALID_ARGUMENT', 'scroll_to takes a ref or a text']);
    expect((await failure(setUp({device: new FakeDevice({scrollIntoView: undefined})}).hands.scrollTo({text: 'Privacy'})))?.[0]).toBe('UNSUPPORTED_CAPABILITY');
  });
});

describe('going somewhere', () => {
  it("opens a route of the app's, a web URL or the app's own scheme, and refuses the rest", async () => {
    const {hands, device} = setUp({host: {scheme: 'entz'}, uniques: {id: 'run-81'}});
    await hands.navigate('/settings/run-81');
    await hands.navigate('https://example.com/');
    await hands.navigate('entz://open');
    expect(device.calls).toEqual(['open /settings/run-81', 'open https://example.com/', 'open entz://open']);
    expect(hands.recorded[0]?.input).toEqual({url: '/settings/{{param:id}}'});
    expect((await failure(hands.navigate('file:///etc/passwd')))?.[0]).toBe('POLICY_DENIED');
  });

  it('goes back, closes the keyboard, and holds a press, through the driver', async () => {
    const {hands, device} = setUp();
    await hands.back();
    await hands.dismissKeyboard();
    await hands.longPress('@e5');
    await hands.longPress('@e5', 1500);
    expect(device.calls).toEqual(['control back', 'control dismissKeyboard', 'longPress {"ref":"@e14"} 800', 'longPress {"ref":"@e14"} 1500']);
    expect((await failure(setUp({device: new FakeDevice({control: undefined})}).hands.back()))?.[0]).toBe('UNSUPPORTED_CAPABILITY');
  });
});

describe('a picture of the screen', () => {
  /** A PNG the driver writes: the screen at twice its size, all one grey. */
  const writer = (width = 800, height = 1600) => (file: string) => {
    fs.writeFileSync(file, encodePng({width, height, pixels: Buffer.alloc(width * height * 4, 128)}));
    return Promise.resolve(done());
  };

  it('is the screen with each secure field painted over, made small, and the file it came in gone', async () => {
    const device = new FakeDevice({screenshot: writer()});
    const {hands} = setUp({device});
    const picture = await hands.screenshot();
    if ('withheld' in picture) throw new Error(picture.withheld);
    expect([picture.mediaType, picture.width, picture.height]).toEqual(['image/png', 384, 768]);
    const image = decodePng(Buffer.from(picture.data, 'base64'));
    // The password field is 20,120 to 220,150 in the tree, 40,240 to 440,300 taken, 19,115 to 211,144 sent.
    expect([...image.pixels.subarray((130 * 384 + 100) * 4, (130 * 384 + 100) * 4 + 4)]).toEqual([...MASK]);
    expect([...image.pixels.subarray((400 * 384 + 100) * 4, (400 * 384 + 100) * 4 + 4)]).toEqual([128, 128, 128, 128]);
    expect(fs.readdirSync(scratch).filter(file => file.endsWith('.png'))).toEqual([]);
  });

  it("presses a point of the last picture at the screen's own units", async () => {
    const {hands, device} = setUp({device: new FakeDevice({screenshot: writer()})});
    expect(await failure(hands.tapAt(10, 10))).toEqual(['INVALID_ARGUMENT', 'tap_at presses a point of the last screenshot, and none has been taken']);
    await hands.screenshot();
    await hands.tapAt(192, 384);
    expect(device.calls).toEqual(['press {"x":200,"y":400}']);
    expect(hands.recorded[0]).toEqual({tool: 'tap_at', input: {x: 200, y: 400}});
    expect(await failure(hands.tapAt(400, 10))).toEqual(['INVALID_ARGUMENT', '400,10 is outside the last screenshot, which is 384 by 768']);
    expect((await failure(hands.tapAt(-1, 10)))?.[0]).toBe('INVALID_ARGUMENT');
  });

  it('is withheld, with the reason, after a secret was filled, where the platform takes none, or where the driver did not take one', async () => {
    const taints = {};
    taint(taints);
    const after = setUp({device: new FakeDevice({screenshot: writer()}), taintStore: taints});
    expect(await after.hands.screenshot()).toEqual({withheld: 'a secret was filled in this test, so no picture of the screen leaves it'});
    expect(await failure(after.hands.tapAt(1, 1))).toEqual(['POLICY_DENIED', 'a secret was filled in this test, so the pixel tools are off']);
    clearTaint(taints);
    expect(await setUp({host: {capabilities: new Set()}}).hands.screenshot()).toEqual({withheld: 'the platform takes no screenshot'});
    const refused = new FakeDevice({screenshot: () => Promise.resolve({ok: false, message: 'the window is gone'})});
    expect(await setUp({device: refused}).hands.screenshot()).toEqual({withheld: 'the window is gone'});
    const skipped = new FakeDevice({screenshot: () => Promise.resolve({ok: true, skipped: true, message: 'no screen'})});
    expect(await setUp({device: skipped}).hands.screenshot()).toEqual({withheld: 'no screen'});
    const unbounded = new FakeDevice({screenshot: writer()});
    unbounded.screen = {...signIn(), nodes: signIn().nodes.map(each => (each.secure ? {...each, bounds: undefined} : each))};
    expect(await setUp({device: unbounded}).hands.screenshot()).toEqual({withheld: 'the secure field @e3 has no bounds to paint over, so a picture could show it'});
  });

  it("is a person's at the size asked, by the same rules, and leaves tap_at aiming at the model's last", async () => {
    const {hands} = setUp({device: new FakeDevice({screenshot: writer()})});
    const picture = await hands.picture(1000);
    expect('withheld' in picture ? null : [picture.width, picture.height]).toEqual([500, 1000]);
    expect(await failure(hands.tapAt(10, 10))).toEqual(['INVALID_ARGUMENT', 'tap_at presses a point of the last screenshot, and none has been taken']);
    const taints = {};
    taint(taints);
    expect(await setUp({device: new FakeDevice({screenshot: writer()}), taintStore: taints}).hands.picture(1000)).toEqual({withheld: 'a secret was filled in this test, so no picture of the screen leaves it'});
  });

  it('keeps the long side the step asks for', async () => {
    const picture = await setUp({device: new FakeDevice({screenshot: writer()}), screenshotMaxSide: 400}).hands.screenshot();
    expect('withheld' in picture ? null : [picture.width, picture.height]).toEqual([200, 400]);
  });
});
