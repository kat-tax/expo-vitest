/**
 * A web device for the unit tests: a sign-in form on a screen a test can
 * change, behind a driver that keeps every call it is sent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Journal} from '../../device/evidence.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../../harness/lib/snapshot.ts';
import type {ControlRequest, Driver, StepResult} from '../../harness/lib/types.ts';
import type {ActingHost} from '../hands.ts';

export const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: false, ...extra});
export const done = (message = 'done'): StepResult => ({ok: true, message});

/** A sign-in form on web, as the platform numbers it, or the screen after it. */
export function signIn(state: {email?: string; remember?: boolean; signedIn?: boolean} = {}): Snapshot {
  if (state.signedIn) return {platform: 'web', viewport: {width: 400, height: 800}, nodes: [node('@e30', 'heading', 'Welcome back', {heading: 1})]};
  return {
    platform: 'web',
    viewport: {width: 400, height: 800},
    nodes: [
      node('@e10', 'form', 'Sign in'),
      node('@e11', 'textbox', 'Email', {interactive: true, parent: '@e10', value: state.email ?? '', bounds: {x: 20, y: 60, width: 200, height: 30}}),
      node('@e12', 'textbox', 'Password', {interactive: true, secure: true, parent: '@e10', bounds: {x: 20, y: 120, width: 200, height: 30}}),
      node('@e13', 'checkbox', 'Remember me', {interactive: true, checked: state.remember ?? false, parent: '@e10', bounds: {x: 20, y: 180, width: 20, height: 20}}),
      node('@e14', 'button', 'Sign in', {interactive: true, parent: '@e10', bounds: {x: 20, y: 240, width: 100, height: 40}}),
    ],
  };
}

/** A web driver over a screen a test can change, every call kept. */
export class FakeDevice {
  screen: Snapshot = signIn();
  readonly calls: string[] = [];
  /** What a press does to the screen. */
  onPress: (target: Target) => Snapshot | undefined = () => undefined;
  readonly driver: Driver;

  constructor(overrides: Partial<Driver> = {}) {
    const record = (call: string, result: StepResult = done()) => {
      this.calls.push(call);
      return Promise.resolve(result);
    };
    this.driver = {
      platform: 'web',
      available: () => Promise.resolve({ready: true}),
      open: target => record(`open ${target}`),
      snapshot: () => Promise.resolve(this.screen),
      press: (target, options) => {
        this.screen = this.onPress(target) ?? this.screen;
        return record(`press ${JSON.stringify(target)}${options?.count ? ` count ${options.count}` : ''}`);
      },
      fill: (target, text) => record(`fill ${JSON.stringify(target)} ${JSON.stringify(text)}`),
      type: text => record(`type ${JSON.stringify(text)}`),
      key: name => record(`key ${name}`),
      longPress: (target, options) => record(`longPress ${JSON.stringify(target)} ${options?.duration}`),
      swipe: (from: Point, to: Point) => record(`swipe ${from.x},${from.y} ${to.x},${to.y}`),
      scrollIntoView: (target, options) => record(`scrollIntoView ${JSON.stringify(target)} ${options?.direction}`),
      control: (request: ControlRequest) => record(`control ${request.name}`),
      screenshot: file => record(`screenshot ${path.basename(file)}`),
      idleSeconds: () => Promise.resolve(null),
      close: () => Promise.resolve(),
      ...overrides,
    };
  }
}

/** A folder of the system's for the screenshots a test's hands take. */
export const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-agent-'));

/** What a device's hands act through, over a fake device, with a journal begun. */
export function hostOf(device: FakeDevice, overrides: Partial<ActingHost> = {}): ActingHost {
  const journal = new Journal();
  journal.begin();
  return {
    platform: 'web',
    ready: () => Promise.resolve(device.driver),
    snapshot: () => device.driver.snapshot(),
    journal,
    capabilities: new Set(['press', 'fill', 'key', 'screenshot', 'swipe', 'open', 'back', 'dismissKeyboard', 'longPress']),
    scratch,
    ...overrides,
  };
}
