/**
 * What a unit test's device drives in place of a platform's own driver: the
 * tree the test rendered, read and acted on in the test's own process. Each
 * unit project's setup file names one for its platform. A device project
 * names none, and the device opens the platform's driver, so `device`,
 * `screen` and the matchers are the same in both.
 */
import type {Driver, Platform} from '../harness/lib/types.ts';

/** What `render` takes beside the element: a component to wrap it in, such as the app's providers. */
export interface RenderOptions {
  wrapper?: unknown;
}

/** What `render` answers: a way to render again in place, and to take it away. */
export interface Rendered {
  rerender(ui: unknown): Promise<void>;
  unmount(): Promise<void>;
}

export interface Surface {
  readonly platform: Platform;
  /** The driver over what the test rendered. */
  driver(): Driver;
  /** Renders an element for the test, in place of what it rendered before. */
  render(ui: unknown, options?: RenderOptions): Promise<Rendered>;
}

let current: Surface | null = null;

/** Names the surface this test process drives, from a unit project's setup file. */
export function setSurface(surface: Surface): void {
  current = surface;
}

/** The surface this process drives, or null in a device project, which drives a platform's own driver. */
export function currentSurface(): Surface | null {
  return current;
}
