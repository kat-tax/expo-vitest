import type {HarnessCode} from './errors.ts';
import type {Snapshot, Target} from './snapshot.ts';

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

export interface SnapshotOptions {
  /** Only what a person can act on, which is what a test usually wants. */
  interactive?: boolean;
}

export interface PressOptions {
  /**
   * `pointer` presses with the pointer even where the control has a pattern
   * to press it by, for a control whose pattern does not do what a press
   * does. Windows only; the other platforms always press as a person would.
   */
  via?: 'pointer';
}

export interface FillOptions {
  /** `keys` clicks and types even where the field could be filled through its Value pattern. Windows only. */
  via?: 'keys';
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
  /** Whether this driver can work here, without changing anything. */
  available(): Promise<Availability>;
  /** Opens a route: a deep link, a URL, or a path resolved against the app's base. */
  open(target: string): Promise<StepResult>;
  /** The accessibility tree, with a ref and bounds for every node. */
  snapshot(options?: SnapshotOptions): Promise<Snapshot>;
  /** A press on what a ref, a selector or a point names. */
  press(target: Target, options?: PressOptions): Promise<StepResult>;
  /** Puts text into the field a target names: focus it, then type. */
  fill(target: Target, text: string, options?: FillOptions): Promise<StepResult>;
  /** Types into whatever has focus. */
  type(text: string): Promise<StepResult>;
  /**
   * A named key pressed where the focus is — `ArrowDown`, `Home`, `Enter` —
   * so a test can check the keyboard contract behind a composite role rather
   * than only the roles themselves.
   *
   * Optional: a backend that cannot send one leaves it off, and the step is
   * skipped rather than failed.
   */
  key?(name: string): Promise<StepResult>;
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
}
