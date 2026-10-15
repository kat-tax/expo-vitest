/**
 * The geometry a screenshot is compared over: a rectangle from the tree
 * scaled into a picture's pixels, kept inside it, painted over, or cut out.
 * Pure, so the matcher's masks and crops are proved here and not on a
 * screen.
 */
import type {Image} from './png.ts';

/** A rectangle of a picture, in its pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A rectangle in the tree's units, in a picture's pixels: scaled by
 * `factor`, the picture's width over the viewport's, and rounded outward,
 * so what it covered is still covered.
 */
export function scaleRect(rect: Rect, factor: number): Rect {
  const x = Math.floor(rect.x * factor);
  const y = Math.floor(rect.y * factor);
  return {x, y, width: Math.ceil((rect.x + rect.width) * factor) - x, height: Math.ceil((rect.y + rect.height) * factor) - y};
}

/** What of a rectangle is inside a picture, in whole pixels; null where none of it is. */
export function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const left = Math.max(0, Math.round(rect.x));
  const top = Math.max(0, Math.round(rect.y));
  const right = Math.min(width, Math.round(rect.x + rect.width));
  const bottom = Math.min(height, Math.round(rect.y + rect.height));
  return right > left && bottom > top ? {x: left, y: top, width: right - left, height: bottom - top} : null;
}

/** The colour a mask paints: magenta, which a screen seldom shows. */
export const MASK: readonly [number, number, number, number] = [255, 0, 255, 255];

/**
 * A copy of a picture with each rectangle painted one colour. Painted in a
 * baseline and in a new picture alike, what is under them is never compared,
 * so adding a mask needs no new baseline.
 */
export function maskImage(image: Image, rects: Rect[], colour: readonly [number, number, number, number] = MASK): Image {
  const pixels = Buffer.from(image.pixels);
  for (const rect of rects) {
    const inside = clampRect(rect, image.width, image.height);
    if (!inside) continue;
    for (let y = inside.y; y < inside.y + inside.height; y++) {
      for (let x = inside.x; x < inside.x + inside.width; x++) pixels.set(colour, (y * image.width + x) * 4);
    }
  }
  return {width: image.width, height: image.height, pixels};
}

/** The part of a picture a rectangle covers, as a picture of its own; null where it covers none of it. */
export function cropImage(image: Image, rect: Rect): Image | null {
  const inside = clampRect(rect, image.width, image.height);
  if (!inside) return null;
  const pixels = Buffer.alloc(inside.width * inside.height * 4);
  for (let row = 0; row < inside.height; row++) {
    const from = ((inside.y + row) * image.width + inside.x) * 4;
    image.pixels.copy(pixels, row * inside.width * 4, from, from + inside.width * 4);
  }
  return {width: inside.width, height: inside.height, pixels};
}
