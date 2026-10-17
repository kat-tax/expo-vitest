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

/**
 * A picture made smaller, so its long side is at most `maxSide`: each new
 * pixel the average of the old ones it covers, each weighted by how much of
 * it is covered, which is a box filter. A picture already that small comes
 * back as it is.
 */
export function resizeImage(image: Image, maxSide: number): Image {
  const long = Math.max(image.width, image.height);
  if (long <= maxSide) return image;
  const width = Math.max(1, Math.round((image.width * maxSide) / long));
  const height = Math.max(1, Math.round((image.height * maxSide) / long));
  const across = image.width / width;
  const down = image.height / height;
  const from = image.pixels;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const top = y * down;
    const bottom = Math.min(top + down, image.height);
    for (let x = 0; x < width; x++) {
      const left = x * across;
      const right = Math.min(left + across, image.width);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let total = 0;
      for (let row = Math.floor(top); row < bottom; row++) {
        const tall = Math.min(row + 1, bottom) - Math.max(row, top);
        for (let column = Math.floor(left); column < right; column++) {
          const weight = tall * (Math.min(column + 1, right) - Math.max(column, left));
          const at = (row * image.width + column) * 4;
          red += (from[at] as number) * weight;
          green += (from[at + 1] as number) * weight;
          blue += (from[at + 2] as number) * weight;
          alpha += (from[at + 3] as number) * weight;
          total += weight;
        }
      }
      const to = (y * width + x) * 4;
      pixels[to] = Math.round(red / total);
      pixels[to + 1] = Math.round(green / total);
      pixels[to + 2] = Math.round(blue / total);
      pixels[to + 3] = Math.round(alpha / total);
    }
  }
  return {width, height, pixels};
}
