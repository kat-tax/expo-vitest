import {describe, expect, it} from 'vitest';
import {PINCH_SPREAD, PINCH_STEPS, pinchTouches} from './gestures.ts';

describe('a pinch', () => {
  it('starts with the fingers either side of the point and ends them scale times as far apart', () => {
    const touches = pinchTouches({x: 200, y: 300}, 2);
    expect(touches).toHaveLength(PINCH_STEPS + 1);
    expect(touches[0]).toEqual([{x: 150, y: 300}, {x: 250, y: 300}]);
    expect(touches.at(-1)).toEqual([{x: 100, y: 300}, {x: 300, y: 300}]);
    const apart = touches.map(([left, right]) => right.x - left.x);
    expect(apart.every((distance, at) => at === 0 || distance > (apart[at - 1] as number))).toBe(true);
  });

  it('draws them together for a scale below 1, in as many steps as asked', () => {
    const touches = pinchTouches({x: 100, y: 50}, 0.5, 2);
    expect(touches.map(([left, right]) => right.x - left.x)).toEqual([PINCH_SPREAD, 75, 50]);
  });
});
