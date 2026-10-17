/**
 * A gesture of two fingers as the touches a driver sends one at a time,
 * for a backend with no gesture of its own: a browser over its DevTools
 * protocol takes each touch, and nothing more.
 */
import type {Point} from './snapshot.ts';

/** How far apart a pinch's fingers start, in px: far enough apart that a page tells them from one touch, near enough for a small element. */
export const PINCH_SPREAD = 100;

/** How many moves a pinch makes between its first touch and its last: enough that a page following them sees them move. */
export const PINCH_STEPS = 10;

/**
 * Where the two fingers of a pinch are, from their first touch to their
 * last: level with `at`, one either side, `PINCH_SPREAD` apart at first and
 * `scale` times that at the end, in even steps.
 */
export function pinchTouches(at: Point, scale: number, steps = PINCH_STEPS): [Point, Point][] {
  const touches: [Point, Point][] = [];
  for (let step = 0; step <= steps; step++) {
    const half = (PINCH_SPREAD / 2) * (1 + (scale - 1) * (step / steps));
    touches.push([
      {x: Math.round(at.x - half), y: at.y},
      {x: Math.round(at.x + half), y: at.y},
    ]);
  }
  return touches;
}
