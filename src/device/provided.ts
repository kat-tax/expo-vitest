/**
 * What a device project hands its global setups and its tests through
 * Vitest's `provide`, by key. The config sets the first three; the global
 * setup sets the rest.
 */
import type {Platform} from '../harness/lib/types.ts';

/** A command the run uses for a platform's app, as the tests see it. */
export interface ProvidedCommand {
  key: string;
  /** The process started, or null where one already answering was used. */
  pid: number | null;
  reused: boolean;
  log: string | false;
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The platform the project drives. */
    'harness.platform': Platform;
    /** The project root. */
    'harness.root': string;
    /** The harness config, or null where there is none. */
    'harness.file': string | null;
    /** A hash of the config the main process loaded, which a worker's load of it must match. */
    'harness.config': string;
    /** The command that serves the platform's app, or null where it has none. */
    'harness.command': ProvidedCommand | null;
    /** Whether the platform's driver can work here, as the warm-up found it. */
    'harness.available': ProvidedAvailability;
  }
}

/** What the warm-up found of a platform's driver. */
export interface ProvidedAvailability {
  ready: boolean;
  /** The device, browser or window the driver found. */
  found?: string;
  /** Why it cannot work here, in the driver's own sentence. */
  reason?: string;
}
