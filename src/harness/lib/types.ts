import type {HarnessCode} from './errors.ts';
import type {ReactTree} from './react.ts';
import type {Point, Snapshot, Target} from './snapshot.ts';

/** The platforms the harness can drive. */
export type Platform = 'web' | 'windows' | 'android' | 'ios';

export const PLATFORMS: Platform[] = ['web', 'windows', 'android', 'ios'];

/** Whether a driver can work on this machine right now, and what is missing when it cannot. */
export interface Availability {
  ready: boolean;
  /** What the driver found: the device, the browser, the window. */
  found?: string;
  /** Why it cannot work, in a sentence a person can act on. */
  reason?: string;
}

/** What a step did. `skipped` is for what a platform has no counterpart for, which is not a failure. */
export interface StepResult {
  ok: boolean;
  skipped?: boolean;
  /** One line about what happened, for the log. */
  message: string;
  /** What the step read, when it read something (a tree, a number). */
  output?: string;
  /** What kind of failure it was, when it was one. */
  code?: HarnessCode;
  /** Set when the driver saw the step take effect, as when a Windows press read the control's new state back. */
  verified?: boolean;
}

export function ok(message: string, output?: string): StepResult {
  return {ok: true, message, output};
}

export function failed(message: string, code: HarnessCode = 'ACTION_FAILED'): StepResult {
  return {ok: false, message, code};
}

/** For what this platform cannot do, said honestly, and not as an error. */
export function elsewhere(what: string, platform: Platform, note = ''): StepResult {
  return {ok: true, skipped: true, message: `${what} is not something the ${platform} harness can do${note ? `: ${note}` : ''}`};
}

/** A step in the app's life, by name, with what it takes. */
export type ControlRequest =
  | {name: 'restart'}
  | {name: 'clearState'}
  | {name: 'back'}
  | {name: 'home'}
  | {name: 'installApp'; path?: string; reinstall?: boolean}
  | {name: 'openLink'; url: string}
  | {name: 'foregroundApp'};

export type ControlName = ControlRequest['name'];

/** What a control did, and for one that reads something, such as the app in front, what it read. */
export interface ControlResult extends StepResult {
  value?: string;
}

/** What a driver knows of the app for a fresh launch, from the harness config. */
export interface AppOptions {
  /** iOS and Android: the installed app. */
  bundleId?: string;
  /** iOS and Android: a build to install; Windows: an `.msix`. */
  appPath?: string;
  /** What every fresh launch is given: process arguments on iOS, extras on Android, the exe's arguments on Windows. */
  launchArguments?: string[];
  /** Set before each fresh launch on iOS and Android, and granted on web. */
  permissions?: Record<string, 'grant' | 'deny' | 'reset'>;
  /** Windows: the folder `clearState` deletes. */
  stateDir?: string;
}

export interface SnapshotOptions {
  /** Only what a person can act on, which is what a test usually wants. */
  interactive?: boolean;
}

/** How a step waits for the screen afterwards; see `src/harness/lib/settle.ts`. */
export interface StepTiming {
  /** How long the screen must hold still after the step, in ms; 0 or `false` for no wait. */
  settle?: number | false;
  /** How long a control the last step brought in or moved is given before it is pressed, in ms; 0 or `false` for none. */
  transition?: number | false;
  /** How long the step waits for the screen to hold still before it goes on regardless, in ms. */
  settleTimeout?: number;
}

export interface PressOptions extends StepTiming {
  /**
   * `pointer` presses with the pointer even where the control has a pattern
   * to press it by, for a control whose pattern does not do what a press
   * does. Windows only; the other platforms always press as a person would.
   */
  via?: 'pointer';
}

export interface FillOptions extends StepTiming {
  /** `keys` clicks and types even where the field could be filled through its Value pattern. Windows only. */
  via?: 'keys';
}

export interface LongPressOptions extends StepTiming {
  /** How long the press is held, in ms. */
  duration?: number;
}

/** The way something is scrolled or swiped: the way the content moves for a scroll, the way the finger moves for a swipe. */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface ScrollIntoViewOptions extends StepTiming {
  /** Which way the node is from the screen, for a backend that scrolls until it sees it. `down` by default. */
  direction?: 'up' | 'down';
}

/**
 * One platform's driver, in the shape `agent-device` uses so a test reads the
 * same whichever is underneath: take a snapshot, then act on what it named.
 *
 * Every method answers rather than throws: a step that a platform has no
 * counterpart for is `skipped`, not a failure, so a script written for four
 * platforms runs on all of them and says what it could not do.
 */
export interface Driver {
  readonly platform: Platform;
  /**
   * Whether press, fill and type wait for the screen to hold still by
   * themselves, given `settle` and `settleTimeout` in their options, as
   * agent-device's do. Otherwise the harness reads the tree until it agrees.
   */
  readonly settles?: boolean;
  /** Whether this driver can work here, without changing anything. */
  available(): Promise<Availability>;
  /** Opens a route: a deep link, a URL, or a path resolved against the app's base. */
  open(target: string): Promise<StepResult>;
  /** The accessibility tree, with a ref and bounds for every node. */
  snapshot(options?: SnapshotOptions): Promise<Snapshot>;
  /** A press on what a ref, a selector or a point names. */
  press(target: Target, options?: PressOptions): Promise<StepResult>;
  /** Puts text into the field a target names, in place of what it held, as agent-device and Playwright do. */
  fill(target: Target, text: string, options?: FillOptions): Promise<StepResult>;
  /** Types into whatever has focus. */
  type(text: string, options?: StepTiming): Promise<StepResult>;
  /**
   * A named key pressed where the focus is — `ArrowDown`, `Home`, `Enter` —
   * so a test can check the keyboard contract behind a composite role rather
   * than only the roles themselves.
   *
   * Optional: a backend that cannot send one leaves it off, and the step is
   * skipped rather than failed.
   */
  key?(name: string): Promise<StepResult>;
  /**
   * The actions a backend may have no counterpart for. Each is left off where
   * it is, and a locator then answers `skipped` or says the platform cannot.
   */
  /** A press held for `duration` ms, as for a context menu. */
  longPress?(target: Target, options?: LongPressOptions): Promise<StepResult>;
  /** The pointer moved over what a target names, without pressing. */
  hover?(target: Target): Promise<StepResult>;
  /** The keyboard focus moved to what a target names, without pressing it. */
  focus?(target: Target): Promise<StepResult>;
  /** What a target names, scrolled until it is on screen. */
  scrollIntoView?(target: Target, options?: ScrollIntoViewOptions): Promise<StepResult>;
  /** A finger drawn from one point to another, in the window's own pixels. */
  swipe?(from: Point, to: Point, options?: StepTiming): Promise<StepResult>;
  /** The React tree behind the native one, or why it cannot be read here. */
  react?(): Promise<ReactTree | {unavailable: string}>;
  /**
   * The app's life by name: a fresh launch, its state cleared, back, home, a
   * link, the app in front. A platform with no counterpart for one answers
   * `skipped`, with the reason.
   */
  control?(request: ControlRequest): Promise<ControlResult>;
  /** Calls `listener` with each line the app writes to its console, and each error it does not catch; the function it answers stops that. */
  onConsole?(listener: (level: string, text: string) => void): () => void;
  /** Saves a PNG of what is on screen. */
  screenshot(file: string): Promise<StepResult>;
  /** Seconds since the user last touched this machine; null where the question has no meaning. */
  idleSeconds(): Promise<number | null>;
  /** Releases whatever the driver is holding (a browser, a connection). */
  close(): Promise<void>;
}

/** What a driver is given when it is made. */
export interface DriverOptions {
  /** The repository root. */
  root: string;
  /** Where the app is served or installed, when the platform needs telling. */
  url?: string;
  /** The app's URI scheme, for deep links. */
  scheme?: string;
  /** The window, process, device or bundle id to drive, where a platform has more than one. */
  target?: string;
  /**
   * Synthetic input even while someone is using the machine. Windows only,
   * where the driver otherwise refuses a press, a fill, typing or a key until
   * the desk has been quiet for three minutes.
   */
  force?: boolean;
  /** The app, for its fresh launches and its state. */
  app?: AppOptions;
}
