import {describe, expect, it} from 'vitest';
import {checkRoute, distance, route} from './travel.ts';

const london = {latitude: 51.5074, longitude: -0.1278};
const paris = {latitude: 48.8566, longitude: 2.3522};

describe('a route', () => {
  it('measures a leg over the earth', () => {
    expect(Math.round(distance(london, paris) / 1000)).toBe(344);
    expect(distance(london, london)).toBe(0);
  });

  it('is a position a second at the speed, along each leg, ending on the last place', () => {
    const north = {latitude: 0.0001, longitude: 0};
    // About 11 m, at 5 m a second: three seconds, the last of them on the place.
    const positions = route([{latitude: 0, longitude: 0}, north], 5);
    expect(positions).toHaveLength(4);
    expect(positions[0]).toEqual({latitude: 0, longitude: 0});
    expect(positions.at(-1)).toEqual(north);
    // A leg shorter than a second's travel still takes one, and two places at one spot take a second there.
    expect(route([north, {latitude: 0.0001, longitude: 0.00001}, {latitude: 0.0001, longitude: 0.00001}], 1000)).toHaveLength(3);
    expect(route([], 10)).toEqual([]);
  });

  it('takes two places or more on the earth, and a speed above 0', () => {
    expect(() => checkRoute([london, paris], 100, 'web')).not.toThrow();
    expect(() => checkRoute([london], 100, 'web')).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'travel takes two places or more, and was given 1; setLocation puts the device at one'}));
    expect(() => checkRoute([london, {latitude: 91, longitude: 0}], 100, 'ios')).toThrow(expect.objectContaining({platform: 'ios', message: "travel's place 2 is not one on the earth: a latitude from -90 to 90 and a longitude from -180 to 180"}));
    expect(() => checkRoute([london, {latitude: 0, longitude: Number.NaN}], 100, 'web')).toThrow(/place 2/);
    for (const speed of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) expect(() => checkRoute([london, paris], speed, 'web')).toThrow(`travel takes a speed in metres a second, above 0; it was given ${speed}`);
  });
});
