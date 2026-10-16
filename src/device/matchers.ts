/**
 * Matchers for the device tests. Registered by the device project's setup file.
 *
 * The assertion is the accessibility tree rather than the pixels. A tree is
 * stable across machines and scale factors, it diffs legibly in review, and it
 * is what a screen reader reads — so a regression in it is a regression a
 * person would feel. Screenshots are still taken, as evidence to look at when
 * something fails, not as the thing being asserted.
 */
import fs from 'node:fs';
import path from 'node:path';
import {expect} from 'vitest';
import {HarnessError} from '../harness/lib/errors.ts';
import type {Rect} from '../harness/lib/image.ts';
import {maskImage} from '../harness/lib/image.ts';
import {compareImages, decodePng, encodePng} from '../harness/lib/png.ts';
import type {Selector, Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {describeTarget, findNode} from '../harness/lib/snapshot.ts';
import {LOCATOR_MATCHERS} from './expectations.ts';
import type {Locator} from './locator.ts';
import {hostOf} from './locator.ts';
import type {ScreenshotOptions} from './screenshots.ts';
import {allowanceOf, isRect, mismatchMessage, regionOf, scaleFactor, stillPicture, subjectOf, updatingBaselines, withinAllowance} from './screenshots.ts';
// The evidence a failing test leaves: the screen, the tree and a trace.
import './evidence-hook.ts';

/** The project under test: where the tests are run from, unless `HARNESS_ROOT` names it. */
const ROOT = path.resolve(process.env.HARNESS_ROOT ?? process.cwd());

/** What a screenshot is compared against, kept per platform because they do not look alike. */
export function baselineFor(platform: string, name: string): string {
  return path.join(ROOT, 'device', '__screenshots__', platform, `${name}.png`);
}

/** Something that can take its own picture: the device, in practice. The tree and the waits are for masks, clips and an element. */
interface Photographable {
  platform: string;
  screenshot(name: string): Promise<string>;
  fullSnapshot?(): Promise<Snapshot>;
  polling?: {assertionTimeout: number};
  can?(capability: string): boolean;
}

/** The rectangles a mask or a clip names, in the tree's units, against one tree; one that names nothing is an error, not a mask of nothing. */
function rectsOf(what: Selector | Locator | Rect, tree: Snapshot, purpose: string): Rect[] {
  if (isRect(what)) return [what];
  const locator = hostOf(what) ? (what as Locator) : null;
  const nodes = locator ? locator.resolve(tree) : [findNode(tree, what as Selector)].filter(node => node !== undefined);
  if (nodes.length === 0) throw new HarnessError('LOCATOR_NOT_FOUND', `${locator ? String(locator) : describeTarget(what as Selector)} names nothing on the screen to ${purpose}`);
  return nodes.flatMap(node => (node.bounds ? [node.bounds] : []));
}

/** What a tree looks like when it is written into a test's expectations. */
export function summarise(snapshot: Snapshot): string[] {
  return snapshot.nodes.map(node => `${node.role} ${JSON.stringify(node.name)}`);
}

/** Every interactive node that a screen reader would announce as nothing but its role. */
export function unnamed(snapshot: Snapshot): SnapshotNode[] {
  return snapshot.nodes.filter(node => node.interactive && !node.name.trim());
}

expect.extend({
  /** The tree contains something the selector names. */
  toHaveElement(received: Snapshot, selector: Selector) {
    const node = findNode(received, selector);
    return {
      pass: Boolean(node),
      message: () =>
        node
          ? `expected no element matching ${describeTarget(selector)}, found ${node.ref} ${node.role} ${JSON.stringify(node.name)}`
          : `expected an element matching ${describeTarget(selector)}; the tree has ${received.nodes.length} nodes:\n  ${summarise(received).join('\n  ')}`,
    };
  },

  /**
   * Every element a person can act on carries an accessible name. This is the
   * check that keeps catching real defects: a glyph-and-text button reads as
   * "button" to Narrator unless the control names itself.
   */
  toBeFullyLabelled(received: Snapshot) {
    const missing = unnamed(received);
    return {
      pass: missing.length === 0,
      message: () =>
        missing.length === 0
          ? `expected some interactive element to have no accessible name, but all ${received.nodes.length} are named`
          : `${missing.length} interactive element${missing.length === 1 ? '' : 's'} would be announced with no name:\n  ` +
            missing.map(node => `${node.ref} ${node.role} at ${node.bounds ? `${node.bounds.x},${node.bounds.y}` : 'unknown'}`).join('\n  '),
    };
  },
});

/** Something whose focus can be moved with a key — the device, in practice. */
interface Navigable {
  platform: string;
  snapshot(options?: {interactive?: boolean}): Promise<Snapshot>;
  key(name: string): Promise<'pressed' | 'skipped'>;
}

/**
 * How a node reads when comparing two snapshots. Refs are numbered per
 * snapshot, so they cannot say whether the focus moved; what a node *is* can.
 */
export function identify(node: SnapshotNode): string {
  return `${node.role} ${node.testId ?? node.name}`;
}

expect.extend({
  /**
   * Pressing the key moves the focus.
   *
   * This is the half of a composite ARIA role that axe cannot check. It reads
   * the roles and never presses anything, so a `role="menu"` or
   * `role="radiogroup"` with no arrow keys behind it passes every static check
   * while being unusable without a pointer — which is exactly what this kit
   * shipped until `src/a11y/roving.ts`. Only a real renderer can answer it.
   */
  async toSupportArrowNavigation(received: Navigable, key = 'ArrowDown') {
    const before = await received.snapshot({interactive: false});
    const from = before.nodes.find(node => node.focused);
    if (!from) {
      return {
        pass: false,
        message: () =>
          `nothing has focus, so ${key} has nowhere to move from — press or focus an element first. ` +
          `The tree has ${before.nodes.length} nodes.`,
      };
    }
    if ((await received.key(key)) === 'skipped') {
      return {pass: true, message: () => `the ${received.platform} harness cannot send ${key}, so this was not checked`};
    }
    const after = await received.snapshot({interactive: false});
    const to = after.nodes.find(node => node.focused);
    const pass = !!to && identify(to) !== identify(from);
    return {
      pass,
      message: () =>
        pass
          ? `expected ${key} to leave the focus on ${identify(from)}, but it moved to ${identify(to!)}`
          : to
            ? `${key} left the focus on ${identify(from)}. A composite role promises the arrow keys move within it; this one does not keep that promise.`
            : `${key} lost the focus entirely — nothing in the tree is focused after it, which is worse than not moving.`,
    };
  },
});

expect.extend({
  /**
   * The screen against a committed baseline, pixel by pixel.
   *
   * The first run writes the baseline and passes, because there is nothing to
   * compare against yet — except in CI, where a missing baseline is a failure
   * rather than something to invent, so a run cannot go green by creating its
   * own expectations. A failure leaves the picture it took and a diff with the
   * changed pixels in red beside it.
   */
  /**
   * The screen, or one element of it, against its baseline. Masks are
   * painted over in both pictures, so a clock or an avatar never fails it,
   * and a clip or an element compares one rectangle. The pictures are taken
   * until two in a row agree.
   */
  async toMatchScreenshot(received: unknown, name: string, options: ScreenshotOptions = {}) {
    const allowed = allowanceOf(options);
    const locator = hostOf(received) ? (received as Locator) : null;
    const camera = (locator ? hostOf(received) : received) as unknown as Photographable;
    const platform = camera.platform;
    // A unit test draws nothing to compare, and a test shared with a device test still runs there.
    if (camera.can?.('screenshot') === false) {
      return {pass: !this.isNot, message: () => `${name} was not compared: ${platform} takes no screenshot here, as in a unit test, which draws nothing`};
    }
    const timeout = camera.polling?.assertionTimeout ?? 5000;
    // An element is brought on screen where the platform scrolls, then found, strictly, as an action finds its node.
    if (locator && camera.can?.('scrollIntoView')) await locator.scrollIntoView();
    const element = locator ? await locator.waitFor({state: 'visible'}) : null;
    const needsTree = Boolean(element || options.clip || options.mask?.length);
    const tree = needsTree && camera.fullSnapshot ? await camera.fullSnapshot() : null;
    const clip = element ? (element.bounds ?? null) : options.clip && tree ? (rectsOf(options.clip, tree, 'clip to')[0] ?? null) : null;
    if ((element || options.clip) && !clip) throw new HarnessError('NOT_ACTIONABLE', `${element ? String(locator) : 'the clip'} has no bounds to compare`, {platform: platform as never});
    const maskRects = tree ? (options.mask ?? []).flatMap(each => rectsOf(each, tree, 'mask')) : [];
    const file = `${platform}-${name}`;
    const take = async () => {
      const image = decodePng(fs.readFileSync(await camera.screenshot(`${file}.actual`)));
      const {region, masks} = regionOf(scaleFactor(image.width, tree?.viewport), clip, maskRects);
      const subject = subjectOf(image, region, masks);
      if (!subject) throw new HarnessError('NOT_ACTIONABLE', `what ${name} compares is outside the picture of the screen`, {platform: platform as never});
      return {...subject, masks};
    };
    const {picture, still} = await stillPicture(take, (a, b) => a.compared.pixels.equals(b.compared.pixels), {timeout});
    const harness = path.join(ROOT, '.harness');
    const actualFile = path.join(harness, `${file}.actual.png`);
    const expectedFile = path.join(harness, `${file}.expected.png`);
    const diffFile = path.join(harness, `${file}.diff.png`);
    // What was compared, the region with its masks, is what a reviewer looks at beside the baseline.
    fs.writeFileSync(actualFile, encodePng(picture.compared));
    const baseline = baselineFor(platform, name);
    const relative = (to: string) => path.relative(ROOT, to);
    // A baseline belongs to the machine that drew it: the same page renders
    // differently under a different font stack, so one recorded on a desk
    // cannot be asserted on a Linux runner. Recording is deliberate, never a
    // side effect of running, and keeps the region without its masks.
    if (updatingBaselines(process.env, expect.getState() as unknown as {snapshotState?: {_updateSnapshot?: string}})) {
      fs.mkdirSync(path.dirname(baseline), {recursive: true});
      fs.writeFileSync(baseline, encodePng(picture.kept));
      return {pass: true, message: () => `recorded a baseline at ${relative(baseline)}`};
    }
    if (!fs.existsSync(baseline)) {
      return {
        pass: true,
        message: () => `no baseline for ${name} on ${platform}; kept ${relative(actualFile)} as evidence. Record one where you mean to assert it: HARNESS_UPDATE_SCREENSHOTS=1, or vitest -u`,
      };
    }
    const expected = maskImage(decodePng(fs.readFileSync(baseline)), picture.masks);
    const result = compareImages(expected, picture.compared, {tolerance: allowed.tolerance});
    if (result.diff) fs.writeFileSync(diffFile, result.diff);
    const pass = withinAllowance(result, allowed);
    const files = {expected: relative(expectedFile), actual: relative(actualFile), diff: relative(diffFile)};
    if (!pass) {
      fs.writeFileSync(expectedFile, encodePng(expected));
      // A code a script can branch on, and the difference as the evidence.
      if (!this.isNot) throw new HarnessError('SCREENSHOT_MISMATCH', mismatchMessage(name, result, allowed, files, still), {platform: platform as never, evidence: diffFile});
    }
    return {
      pass,
      message: () => (pass ? `expected ${name} to differ from its baseline by more than is allowed, but ${result.different} of ${result.total} pixels differ` : mismatchMessage(name, result, allowed, files, still)),
    };
  },
});

// The matchers on a locator, which wait for the tree: `src/device/expectations.ts`.
expect.extend(LOCATOR_MATCHERS);

// Their types are declared beside the locator matchers, in expectations.ts.
