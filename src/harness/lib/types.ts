import type {HarnessCode} from './errors.ts';
import type {ReactTree, StackFrame} from './react.ts';
import type {Point, Snapshot, Target} from './snapshot.ts';

/** The platforms the harness can drive. */
export type Platform = 'web' | 'windows' | 'android' | 'ios';

export const PLATFORMS: Platform[] = ['web', 'windows', 'android', 'ios'];

/** What a driver found of the device it drives, which says what the device can do beyond its platform. */
export interface DeviceFacts {
  /** Its name, as a foldable's says it folds. */
  name?: string;
  /** `simulator`, `emulator`, or `device` for a physical one. */
  kind?: string;
  /** Its operating system's version. */
  osVersion?: string;
}

/** Whether a driver can work on this machine right now, and what is missing when it cannot. */
export interface Availability {
  ready: boolean;
  /** What the driver found: the device, the browser, the window. */
  found?: string;
  /** Why it cannot work, in a sentence a person can act on. */
  reason?: string;
  /** What the driver found of the device, where it can tell. */
  device?: DeviceFacts;
  /** Lines the doctor prints under the platform's, such as each browser on web and whether it is installed. */
  details?: string[];
  /** What the run passes over of what it was asked, a sentence each, which a run says once. */
  notes?: string[];
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

/** Which way up a device is. */
export type Orientation = 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';

/** What a permission is set to. */
export type PermissionState = 'grant' | 'deny' | 'reset';

/** A step in the app's life, or a setting of the device it runs on, by name, with what it takes. */
export type ControlRequest =
  | {name: 'restart'}
  | {name: 'clearState'}
  | {name: 'stopApp'}
  | {name: 'resumeApp'}
  | {name: 'activateApp'; id: string}
  | {name: 'back'}
  | {name: 'home'}
  | {name: 'installApp'; path?: string; reinstall?: boolean}
  | {name: 'openLink'; url: string}
  | {name: 'foregroundApp'}
  | {name: 'setAppearance'; mode: 'light' | 'dark'}
  | {name: 'setOrientation'; orientation: Orientation}
  | {name: 'setNetwork'; online: boolean}
  | {name: 'setAirplaneMode'; on: boolean}
  | {name: 'setPermission'; permission: string; state: PermissionState}
  | {name: 'setLocation'; latitude: number; longitude: number}
  | {name: 'clearLocation'}
  | {name: 'setBiometrics'; sensor: 'faceid' | 'touchid' | 'fingerprint'; result: 'match' | 'nonmatch'}
  | {name: 'enrollBiometrics'; sensor: 'faceid' | 'touchid'; enrolled: boolean}
  | {name: 'fold'; pose: 'closed' | 'half-open' | 'open'}
  | {name: 'clipboard'}
  | {name: 'setClipboard'; text: string}
  | {name: 'dismissKeyboard'}
  | {name: 'alert'; action: 'accept' | 'dismiss'};

export type ControlName = ControlRequest['name'];

/** What a control did, and for one that reads something, such as the app in front, what it read. */
export interface ControlResult extends StepResult {
  value?: string;
}

/** What a driver knows of the app for a fresh launch, from the harness config. */
/** A request a route of a test's answers, as its handler sees it. */
export interface WebRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The body, as text, where there is one. */
  body: string | null;
}

/** What a route's handler does with a request: answers it, lets it through, or fails it. A handler that does none of them lets it through. */
export interface WebRoute {
  readonly request: WebRequest;
  fulfill(response: {status?: number; json?: unknown; body?: string; headers?: Record<string, string>; contentType?: string}): Promise<void>;
  continue(): Promise<void>;
  abort(): Promise<void>;
}

/** How the page's dialogs are answered: always one way, or as a function decides for each. */
export type DialogAnswer = 'accept' | 'dismiss' | ((dialog: {type: string; message: string}) => 'accept' | 'dismiss' | Promise<'accept' | 'dismiss'>);

/** A cookie, as a browser context holds it. A cookie set needs a `url`, or a `domain` and a `path`. */
export interface WebCookie {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  /** When it ends, in seconds since 1970; -1 for the session. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** The option a select is set to: by its label, its value, or its place. */
export type OptionChoice = string | {value: string} | {index: number};

/** What web alone has: the browser's own controls, which a test reaches through `device.web`. */
export interface WebControls {
  /** Answers the requests that match `pattern`, a glob, until the function it answers is called. */
  route(pattern: string, handler: (route: WebRoute) => unknown): Promise<() => Promise<void>>;
  /** Answers every dialog the page opens, until the function it answers is called. */
  onDialog(answer: DialogAnswer): () => void;
  /** An expression evaluated in the page, and its value, which must be JSON. */
  evaluate<T>(expression: string): Promise<T>;
  setViewport(size: {width: number; height: number}): Promise<void>;
  cookies(): Promise<WebCookie[]>;
  setCookies(cookies: WebCookie[]): Promise<void>;
  clearCookies(): Promise<void>;
  /** Writes the context's cookies and storage to a file, as Playwright's `storageState`, and answers with the file. */
  storageState(file: string): Promise<string>;
  /** Runs `trigger`, waits for the download it starts, and keeps the file where `file` says, given the name the page suggested. */
  download(trigger: () => Promise<unknown>, file: (suggested: string) => string): Promise<string>;
  selectOption(target: Target, option: OptionChoice): Promise<StepResult>;
  setInputFiles(target: Target, files: string[]): Promise<StepResult>;
  secondaryTap(target: Target): Promise<StepResult>;
  /** A frame of the page, by a CSS selector for its element: the number its refs carry, as `@f1e3`. */
  frame(selector: string): number;
  /** A frame's tree, with refs that name the frame, and boxes where they are on the page. */
  frameSnapshot(frame: number): Promise<Snapshot>;
}

/** A device a provider hosts, which agent-device connects to before a run and releases after it. */
export interface HostedDevice {
  /** agent-device's name for the provider: `limrun`, `browserstack`, `aws-device-farm` or `testmu`. */
  provider: string;
  /** Flags for agent-device's `connect`, by name without the dashes, as `{'provider-os-version': '14.0'}`. `true` passes a flag alone. */
  options?: Record<string, string | boolean>;
}

export interface AppOptions {
  /** iOS and Android: the installed app. */
  bundleId?: string;
  /** iOS and Android: a build to install; Windows: an `.msix`. */
  appPath?: string;
  /** What every fresh launch is given: process arguments on iOS, extras on Android, the exe's arguments on Windows. */
  launchArguments?: string[];
  /** Set before each fresh launch on iOS and Android, and granted on web. */
  permissions?: Record<string, PermissionState>;
  /** Windows: the folder `clearState` deletes. */
  stateDir?: string;
  /** Web: the file of cookies and storage each fresh context starts from, where it is there, but for `clearState`'s. */
  storageState?: string;
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
  /**
   * Presses in quick succession, taken as one: 2 is a double tap on a device
   * and a double click on web and Windows, and 3 a triple. 1 by default.
   */
  count?: number;
}

export interface FillOptions extends StepTiming {
  /** `keys` clicks and types even where the field could be filled through its Value pattern. Windows only. */
  via?: 'keys';
}

export interface LongPressOptions extends StepTiming {
  /** How long the press is held, in ms. */
  duration?: number;
}

export interface DragOptions {
  /** How long the press is held before it moves, in ms, as a list that reorders on a long press wants. None by default. */
  hold?: number;
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
   * skipped rather than failed. A driver that waits for the screen itself
   * is handed the times, as a press is.
   */
  key?(name: string, options?: StepTiming): Promise<StepResult>;
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
  /** A press on what one target names, drawn to what another names and let go there. */
  drag?(from: Target, to: Target, options?: DragOptions): Promise<StepResult>;
  /**
   * Two fingers either side of a point, in the window's own pixels, drawn
   * apart to `scale` times the distance between them, or together for a
   * scale below 1.
   */
  pinch?(at: Point, scale: number): Promise<StepResult>;
  /** The React tree behind the native one, or why it cannot be read here. */
  react?(): Promise<ReactTree | {unavailable: string}>;
  /** Where each element from a node of the React tree up was written, the innermost first, by the node's id in a walk of the tree as it is. */
  reactFrames?(id: number): Promise<{frames: StackFrame[]} | {unavailable: string}>;
  /**
   * The app's life by name: a fresh launch, its state cleared, back, home, a
   * link, the app in front. A platform with no counterpart for one answers
   * `skipped`, with the reason.
   */
  control?(request: ControlRequest): Promise<ControlResult>;
  /**
   * Records the screen for one test: `start` begins, and `stop` ends and keeps
   * the recording at `file`, its path the answer's `value`, or throws it away
   * without one. Left off where the platform records nothing.
   */
  video?(action: 'start' | 'stop', file?: string): Promise<ControlResult>;
  /** A hosted device's provider connected to, before a run's first test. Left off where the platform has no hosted devices. */
  connect?(hosted: HostedDevice): Promise<StepResult>;
  /** The connection released, and the device with it, after the run's last test. */
  disconnect?(): Promise<StepResult>;
  /**
   * Opens the driver's session on its device, opening nothing in it, which
   * claims the device for the session: agent-device refuses one that another
   * session holds, with `DEVICE_IN_USE`. Left off where there is no such claim.
   */
  attach?(): Promise<StepResult>;
  /** Clears the claims agent-device holds for owners that are gone, after a run. */
  releaseStale?(): Promise<StepResult>;
  /** The browser's own controls, on web alone. */
  readonly web?: WebControls;
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
  /** On a device, whether the status bar is made the same in every screenshot, `fixed`, or left as it is, `real`. */
  statusBar?: 'fixed' | 'real';
  /** How long one call to the driver may take before it is given up on, in ms. */
  actionTimeout?: number;
  /** On web, the browser launched: `chromium`, `firefox` or `webkit`, over `HARNESS_BROWSER`. */
  browser?: string;
  /** On web, the endpoint of a Chromium already running, reached over CDP rather than launched, over `HARNESS_CDP`. */
  cdp?: string;
  /** On a device, the agent-device session to drive it in, where one test file of several holds it. */
  session?: string;
}
