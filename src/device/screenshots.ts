/**
 * What `toMatchScreenshot` decides, as pure functions: its options, the
 * part of a picture it compares, when the screen has held still long enough
 * to take, whether a baseline is to be written, and what a mismatch says.
 * The matcher in `matchers.ts` takes the pictures and reads the tree.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {Rect} from '../harness/lib/image.ts';
import {cropImage, maskImage, scaleRect} from '../harness/lib/image.ts';
import type {Comparison, Image} from '../harness/lib/png.ts';
import type {Clock} from '../harness/lib/settle.ts';
import {realClock} from '../harness/lib/settle.ts';
import type {Selector} from '../harness/lib/snapshot.ts';
import type {Locator} from './locator.ts';

/** How much may differ, as the matcher is told. */
export interface Allowance {
  /** The share of pixels that may differ, 0 to 1. */
  maxRatio?: number;
  /** How many pixels may differ; with `maxRatio` too, the stricter applies. */
  maxDiffPixels?: number;
  /** How far one channel may drift and the pixel still count as the same, 0 to 1. */
  threshold?: number;
}

/** What `toMatchScreenshot` takes. */
export interface ScreenshotOptions extends Allowance {
  /** What is painted over in the baseline and the picture alike before they are compared: the first node a selector names, or every node a locator names. */
  mask?: (Selector | Locator)[];
  /** The one rectangle compared: a node by a selector or a locator, or a rectangle in the tree's units. */
  clip?: Selector | Locator | Rect;
}

/** Whether what a mask or a clip was given is a rectangle rather than a query. */
export function isRect(value: unknown): value is Rect {
  const rect = value as Partial<Rect> | null;
  return typeof rect === 'object' && rect !== null && ['x', 'y', 'width', 'height'].every(key => typeof rect[key as keyof Rect] === 'number');
}

/** The allowance with its defaults: `maxRatio` 0.002, and a channel's drift up to 8 of 255. */
export interface Allowed {
  maxRatio: number;
  maxDiffPixels?: number;
  /** In channel steps, 0 to 255, as `compareImages` takes it. */
  tolerance: number;
}

const fraction = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1;

/** The options checked and filled in; one out of range is \`INVALID_ARGUMENT\`, naming it. */
export function allowanceOf({maxRatio = 0.002, maxDiffPixels, threshold}: Allowance = {}): Allowed {
  if (!fraction(maxRatio)) throw new HarnessError('INVALID_ARGUMENT', `toMatchScreenshot takes maxRatio from 0 to 1, the share of pixels that may differ; it was given ${maxRatio}`);
  if (threshold !== undefined && !fraction(threshold)) throw new HarnessError('INVALID_ARGUMENT', `toMatchScreenshot takes threshold from 0 to 1, how far a channel may drift; it was given ${threshold}`);
  if (maxDiffPixels !== undefined && !(Number.isInteger(maxDiffPixels) && maxDiffPixels >= 0)) {
    throw new HarnessError('INVALID_ARGUMENT', `toMatchScreenshot takes maxDiffPixels as a whole number, 0 or more; it was given ${maxDiffPixels}`);
  }
  return {maxRatio, ...(maxDiffPixels === undefined ? {} : {maxDiffPixels}), tolerance: threshold === undefined ? 8 : Math.round(threshold * 255)};
}

/** Whether what differs is within what is allowed: the share, and the count where one is given. */
export function withinAllowance(result: Comparison, allowed: Allowed): boolean {
  return result.comparable && result.ratio <= allowed.maxRatio && (allowed.maxDiffPixels === undefined || result.different <= allowed.maxDiffPixels);
}

/**
 * Whether a run writes baselines: under \`HARNESS_UPDATE_SCREENSHOTS\`, or
 * \`vitest -u\`, which Vitest's own snapshots learn of from the snapshot
 * state's \`_updateSnapshot\`. It is private to Vitest, and a test pins it.
 */
export function updatingBaselines(environment: NodeJS.ProcessEnv, state: {snapshotState?: {_updateSnapshot?: string}} = {}): boolean {
  const asked = environment.HARNESS_UPDATE_SCREENSHOTS;
  return Boolean(asked && asked !== '0') || state.snapshotState?._updateSnapshot === 'all';
}

/** How many of a picture's pixels a unit of the tree is: its width over the box the tree was measured in, where the driver gave one. */
export function scaleFactor(imageWidth: number, viewport?: {width: number}): number {
  return viewport && viewport.width > 0 ? imageWidth / viewport.width : 1;
}

/** The part of a picture compared, and the masks within it, in its pixels, from rectangles in the tree's units. */
export function regionOf(factor: number, clip: Rect | null, masks: Rect[]): {region: Rect | null; masks: Rect[]} {
  const region = clip && scaleRect(clip, factor);
  const shift = (rect: Rect): Rect => (region ? {...rect, x: rect.x - region.x, y: rect.y - region.y} : rect);
  return {region, masks: masks.map(mask => shift(scaleRect(mask, factor)))};
}

/** What is compared of a picture: the region cut out, then the masks painted; and the region alone, which a baseline keeps. */
export function subjectOf(picture: Image, region: Rect | null, masks: Rect[]): {kept: Image; compared: Image} | null {
  const kept = region ? cropImage(picture, region) : picture;
  return kept && {kept, compared: maskImage(kept, masks)};
}

/**
 * Pictures taken until two in a row are the same, as what is compared of
 * them, up to \`tries\` of them \`gap\` ms apart and within \`timeout\`. A screen
 * still moving when the tries run out is compared as it last was, and the
 * answer says it never held still.
 */
export async function stillPicture<T>(take: () => Promise<T>, same: (a: T, b: T) => boolean, options: {tries?: number; gap?: number; timeout: number; clock?: Clock}): Promise<{picture: T; still: boolean; taken: number}> {
  const {tries = 5, gap = 100, timeout, clock = realClock} = options;
  const deadline = clock.now() + timeout;
  let last = await take();
  let taken = 1;
  while (taken < tries && clock.now() + gap <= deadline) {
    await clock.sleep(gap);
    const next = await take();
    taken++;
    if (same(last, next)) return {picture: next, still: true, taken};
    last = next;
  }
  return {picture: last, still: false, taken};
}

/** What a mismatch says: how much differed against what was allowed, and where the three pictures are. */
export function mismatchMessage(name: string, result: Comparison, allowed: Allowed, files: {expected: string; actual: string; diff?: string}, still = true): string {
  if (!result.comparable) return `${name} cannot be compared with its baseline: ${result.reason}. What it looks like now is in ${files.actual}, and the baseline in ${files.expected}`;
  const limit = [`${(allowed.maxRatio * 100).toFixed(3)}%`, ...(allowed.maxDiffPixels === undefined ? [] : [`${allowed.maxDiffPixels} pixels`])].join(' and ');
  const moving = still ? '' : '. The screen never held still for two pictures in a row';
  return `${name} differs from its baseline in ${result.different} of ${result.total} pixels (${(result.ratio * 100).toFixed(3)}%; allowed ${limit})${moving}. The baseline is in ${files.expected}, what it looks like now in ${files.actual}, and the difference in ${files.diff}`;
}
