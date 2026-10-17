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
  /** A screenshot differs from its baseline by more than was allowed, or cannot be compared with it. */
  | 'SCREENSHOT_MISMATCH'
  /** The node is there, but cannot be acted on: it has no bounds, or is off screen. */
  | 'NOT_ACTIONABLE'
  /** Asked of a platform that has no counterpart, where answering `skipped` would hide a mistake. */
  | 'UNSUPPORTED_CAPABILITY'
  /** A call or a command line that cannot be acted on as it stands. */
  | 'INVALID_ARGUMENT'
  /** A harness config that names something it cannot take, or a value of the wrong kind. */
  | 'INVALID_CONFIG'
  /** Every device in a pool was held by another test file, or a session outside the run, for as long as a file may wait. */
  | 'DEVICE_POOL_EXHAUSTED'
  // An agent step's own, e2e's codes with e2e's meanings.
  /** A judgment could not tell, from what the screen shows. */
  | 'ASSERTION_INCONCLUSIVE'
  /** A step used every model call or action it may. */
  | 'STEP_BUDGET_EXHAUSTED'
  /** A step ran out of time. */
  | 'STEP_TIMEOUT'
  /** The model stopped without saying how the step ended. */
  | 'STEP_NO_CONCLUSION'
  /** What a step sends the model no longer fits its context. */
  | 'CONTEXT_OVERFLOW'
  /** No model to ask: none configured, its package missing, or its credentials refused. */
  | 'MODEL_UNAVAILABLE'
  /** The model's provider failed the call, or declined it. */
  | 'MODEL_PROVIDER_FAILED'
  /** The model answered in a shape the step cannot use, even after a repair. */
  | 'MODEL_OUTPUT_INVALID'
  /** A security rule refused what was asked: a secret, a URL, a file, a screenshot. */
  | 'POLICY_DENIED'
  /** A secret the step needs has no value. */
  | 'SECRET_UNAVAILABLE'
  /** The app asks for something automation cannot do, such as a captcha. */
  | 'AUTOMATION_UNSUPPORTED'
  /** Under a strict cache, a recorded step no longer replays. */
  | 'REPLAY_STALE'
  /** The test was stopped while the step ran. */
  | 'CANCELLED'
  /** The app was not open for the step to act in. */
  | 'APP_NOT_OPEN'
  /** The app refused the credentials the step was given. */
  | 'AUTHENTICATION_FAILED';

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
