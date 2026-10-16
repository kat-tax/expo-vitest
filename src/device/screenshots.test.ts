import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import type {Image} from '../harness/lib/png.ts';
import {compareImages} from '../harness/lib/png.ts';
import type {Clock} from '../harness/lib/settle.ts';
import {allowanceOf, baselinePath, isRect, mismatchMessage, regionOf, scaleFactor, stillPicture, subjectOf, updatingBaselines, withinAllowance} from './screenshots.ts';

function fakeClock(): Clock & {at: number} {
  const clock = {at: 0, now: () => clock.at, sleep: async (ms: number) => void (clock.at += ms)};
  return clock;
}

/** A picture of one grey, with the pixels named changed to black. */
function picture(width: number, height: number, changed: [number, number][] = []): Image {
  const pixels = Buffer.alloc(width * height * 4);
  for (let at = 0; at < width * height; at++) pixels.set([128, 128, 128, 255], at * 4);
  for (const [x, y] of changed) pixels.set([0, 0, 0, 255], (y * width + x) * 4);
  return {width, height, pixels};
}

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;

describe('the allowance', () => {
  it("is a fiftieth of a percent and a channel's drift of 8 unless given", () => {
    expect(allowanceOf()).toEqual({maxRatio: 0.002, tolerance: 8});
    expect(allowanceOf({maxRatio: 0.01, maxDiffPixels: 50, threshold: 0.1})).toEqual({maxRatio: 0.01, maxDiffPixels: 50, tolerance: 26});
    expect(allowanceOf({threshold: 0})).toEqual({maxRatio: 0.002, tolerance: 0});
    expect(allowanceOf({threshold: 1}).tolerance).toBe(255);
  });

  it('refuses a value out of range, naming it', () => {
    expect(() => allowanceOf({maxRatio: 2})).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'toMatchScreenshot takes maxRatio from 0 to 1, the share of pixels that may differ; it was given 2'}));
    expect(() => allowanceOf({threshold: -0.1})).toThrow('toMatchScreenshot takes threshold from 0 to 1, how far a channel may drift; it was given -0.1');
    expect(() => allowanceOf({maxDiffPixels: 1.5})).toThrow('toMatchScreenshot takes maxDiffPixels as a whole number, 0 or more; it was given 1.5');
    expect(() => allowanceOf({maxDiffPixels: -1})).toThrow('it was given -1');
  });

  it('holds the stricter of a share and a count', () => {
    const result = compareImages(picture(10, 10), picture(10, 10, [[0, 0], [1, 1]]));
    expect(withinAllowance(result, allowanceOf({maxRatio: 0.05}))).toBe(true);
    expect(withinAllowance(result, allowanceOf({maxRatio: 0.05, maxDiffPixels: 1}))).toBe(false);
    expect(withinAllowance(result, allowanceOf({maxRatio: 0.01, maxDiffPixels: 10}))).toBe(false);
    expect(withinAllowance(result, allowanceOf({maxRatio: 0.05, maxDiffPixels: 2}))).toBe(true);
    expect(withinAllowance(compareImages(picture(2, 2), picture(3, 3)), allowanceOf({maxRatio: 1}))).toBe(false);
  });
});

describe('where a baseline is', () => {
  it("is the platform's folder, and in it a folder by the app's identity where it has one", () => {
    expect(baselinePath('/app', 'web', 'home')).toBe(path.join('/app', 'device', '__screenshots__', 'web', 'home.png'));
    expect(baselinePath('/app', 'android', 'home', 'com.example.app')).toBe(path.join('/app', 'device', '__screenshots__', 'android', 'com.example.app', 'home.png'));
    expect(baselinePath('/app', 'web', 'home', 'http://localhost:8081/ staging')).toBe(path.join('/app', 'device', '__screenshots__', 'web', 'http-localhost-8081-staging', 'home.png'));
  });
});

describe('writing baselines', () => {
  it('happens under HARNESS_UPDATE_SCREENSHOTS or vitest -u, and not otherwise', () => {
    expect(updatingBaselines(env({HARNESS_UPDATE_SCREENSHOTS: '1'}))).toBe(true);
    expect(updatingBaselines(env({HARNESS_UPDATE_SCREENSHOTS: '0'}))).toBe(false);
    expect(updatingBaselines(env(), {snapshotState: {_updateSnapshot: 'all'}})).toBe(true);
    expect(updatingBaselines(env(), {snapshotState: {_updateSnapshot: 'new'}})).toBe(false);
    expect(updatingBaselines(env())).toBe(false);
  });

  it("reads -u where Vitest 4.1 keeps it, on the snapshot state", () => {
    const state = expect.getState() as unknown as {snapshotState?: {_updateSnapshot?: string}};
    expect(['all', 'new', 'none']).toContain(state.snapshotState?._updateSnapshot);
  });
});

describe('what is compared', () => {
  it('is in pixels: the tree scaled by the picture over the box it was measured in', () => {
    expect(scaleFactor(1170, {width: 390})).toBe(3);
    expect(scaleFactor(1280, {width: 1280})).toBe(1);
    expect(scaleFactor(800)).toBe(1);
    expect(scaleFactor(800, {width: 0})).toBe(1);
  });

  it('is the clip, with the masks moved into it, all scaled', () => {
    expect(regionOf(2, {x: 10, y: 10, width: 20, height: 20}, [{x: 15, y: 12, width: 2, height: 2}])).toEqual({
      region: {x: 20, y: 20, width: 40, height: 40},
      masks: [{x: 10, y: 4, width: 4, height: 4}],
    });
    expect(regionOf(1, null, [{x: 1, y: 2, width: 3, height: 4}])).toEqual({region: null, masks: [{x: 1, y: 2, width: 3, height: 4}]});
  });

  it('keeps the region unmasked for a baseline, and compares it masked', () => {
    const now = picture(8, 8, [[5, 5]]);
    const subject = subjectOf(now, {x: 4, y: 4, width: 4, height: 4}, [{x: 1, y: 1, width: 1, height: 1}]);
    expect([subject?.kept.width, subject?.kept.height]).toEqual([4, 4]);
    expect(subject?.kept.pixels[(1 * 4 + 1) * 4]).toBe(0);
    expect(subject?.compared.pixels[(1 * 4 + 1) * 4]).toBe(255);
    expect(subjectOf(now, null, [])?.kept).toBe(now);
    expect(subjectOf(now, {x: 20, y: 20, width: 2, height: 2}, [])).toBeNull();
  });
});

describe('a still picture', () => {
  const same = (a: number, b: number) => a === b;

  it('is the second of the first two alike', async () => {
    const take = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(2);
    const clock = fakeClock();
    expect(await stillPicture(take, same, {timeout: 5000, clock})).toEqual({picture: 2, still: true, taken: 3});
    expect(clock.at).toBe(200);
  });

  it('is the last of five on a screen that never holds still', async () => {
    let frame = 0;
    const clock = fakeClock();
    expect(await stillPicture(async () => frame++, same, {timeout: 5000, clock})).toEqual({picture: 4, still: false, taken: 5});
  });

  it('stops at the timeout', async () => {
    let frame = 0;
    const clock = fakeClock();
    expect(await stillPicture(async () => frame++, same, {timeout: 150, gap: 100, clock})).toEqual({picture: 1, still: false, taken: 2});
  });

  it('keeps time by the real clock unless given another', async () => {
    expect(await stillPicture(async () => 1, same, {timeout: 1000, gap: 1})).toEqual({picture: 1, still: true, taken: 2});
  });
});

describe('a mismatch', () => {
  const files = {expected: '.harness/web-pay.expected.png', actual: '.harness/web-pay.actual.png', diff: '.harness/web-pay.diff.png'};

  it('says how much differed against what was allowed, and where the three pictures are', () => {
    const result = compareImages(picture(10, 10), picture(10, 10, [[0, 0], [1, 1], [2, 2]]));
    expect(mismatchMessage('pay', result, allowanceOf({maxDiffPixels: 2}), files)).toBe(
      'pay differs from its baseline in 3 of 100 pixels (3.000%; allowed 0.200% and 2 pixels). The baseline is in .harness/web-pay.expected.png, what it looks like now in .harness/web-pay.actual.png, and the difference in .harness/web-pay.diff.png',
    );
    expect(mismatchMessage('pay', result, allowanceOf(), files, false)).toContain('allowed 0.200%). The screen never held still for two pictures in a row. The baseline');
  });

  it('says why two pictures cannot be compared', () => {
    expect(mismatchMessage('pay', compareImages(picture(2, 2), picture(3, 3)), allowanceOf(), files)).toBe(
      'pay cannot be compared with its baseline: the baseline is 2x2 and this is 3x3. What it looks like now is in .harness/web-pay.actual.png, and the baseline in .harness/web-pay.expected.png',
    );
  });
});

describe('a mask or a clip', () => {
  it('is a rectangle when it has the four numbers, and a query otherwise', () => {
    expect(isRect({x: 0, y: 0, width: 10, height: 10})).toBe(true);
    expect(isRect({testId: 'clock'})).toBe(false);
    expect(isRect({x: 1, y: 2})).toBe(false);
    expect(isRect({x: 1, y: 2, width: '3', height: 4})).toBe(false);
    expect(isRect(null)).toBe(false);
    expect(isRect('label="Clock"')).toBe(false);
  });
});
