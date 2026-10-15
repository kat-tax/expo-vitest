/**
 * What kind of failure a step had, in a word a script can branch on. The
 * message is still the whole of what a person reads; the code sits beside it
 * for a caller that has to decide what to do next, and for a table that maps
 * one tool's failures onto another's.
 */
import type {Platform} from './types.ts';

export type HarnessCode =
  /** No backend for the platform here: not installed, not running, not a Windows machine. */
  | 'DRIVER_UNAVAILABLE'
  /** The app did not open: a URL that does not answer, a deep link with no exe to launch. */
  | 'APP_UNREACHABLE'
  /** Something already answers where the run's command would serve the app, and the run may not use it. */
  | 'APP_ALREADY_RUNNING'
  /** Nothing in the tree matched, within the time allowed. */
  | 'LOCATOR_NOT_FOUND'
  /** A query that names one node named several, so a step cannot tell which to act on. */
  | 'LOCATOR_AMBIGUOUS'
  /** The backend refused the step, or failed it. */
  | 'ACTION_FAILED'
  /** The screen did not come to say what a test waited for, within the time allowed. */
  | 'ASSERTION_FAILED'
  /** The node is there, but cannot be acted on: it has no bounds, or is off screen. */
  | 'NOT_ACTIONABLE'
  /** Asked of a platform that has no counterpart, where answering `skipped` would hide a mistake. */
  | 'UNSUPPORTED_CAPABILITY'
  /** A call or a command line that cannot be acted on as it stands. */
  | 'INVALID_ARGUMENT'
  /** A harness config that names something it cannot take, or a value of the wrong kind. */
  | 'INVALID_CONFIG';

export class HarnessError extends Error {
  override readonly name = 'HarnessError';
  readonly code: HarnessCode;
  /** The platform the failure happened on, when it happened on one. */
  declare readonly platform?: Platform;
  /** A file under `.harness/` that shows the failure, when one was written. */
  declare readonly evidence?: string;

  constructor(code: HarnessCode, message: string, options: {platform?: Platform; evidence?: string; cause?: unknown} = {}) {
    super(message, options.cause === undefined ? undefined : {cause: options.cause});
    this.code = code;
    if (options.platform) this.platform = options.platform;
    if (options.evidence) this.evidence = options.evidence;
  }
}

/**
 * Whether something thrown is a harness failure. By its name and code rather
 * than `instanceof`, because a project can load two copies of this package,
 * and a class from one is not the class from the other.
 */
export function isHarnessError(error: unknown): error is HarnessError {
  if (typeof error !== 'object' || error === null) return false;
  const {name, code} = error as {name?: unknown; code?: unknown};
  return name === 'HarnessError' && typeof code === 'string';
}

/** The code something thrown carries, or the one to give it when it carries none. */
export function codeOf(error: unknown, otherwise: HarnessCode = 'ACTION_FAILED'): HarnessCode {
  return isHarnessError(error) ? error.code : otherwise;
}
