/**
 * A route of places as the positions a device is put at on the way, one a
 * second at a speed, as Maestro's `travel` moves a device: along each leg in
 * a straight line of latitude and longitude, which over the legs a test
 * travels is the line a map draws, and at the last place at the end.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {Platform} from '../harness/lib/types.ts';

export interface Place {
  latitude: number;
  longitude: number;
}

/** The earth's mean radius, in metres. */
const EARTH = 6_371_000;

/** How far apart two places are, in metres, over the earth's surface. */
export function distance(a: Place, b: Place): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const across = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(across));
}

/** The places and the speed as given, or `INVALID_ARGUMENT` naming what is wrong. */
export function checkRoute(places: readonly Place[], speed: number, platform: Platform): void {
  const fail = (message: string) => new HarnessError('INVALID_ARGUMENT', message, {platform});
  if (places.length < 2) throw fail(`travel takes two places or more, and was given ${places.length}; setLocation puts the device at one`);
  const wrong = places.findIndex(place => !(Math.abs(place.latitude) <= 90 && Math.abs(place.longitude) <= 180));
  if (wrong >= 0) throw fail(`travel's place ${wrong + 1} is not one on the earth: a latitude from -90 to 90 and a longitude from -180 to 180`);
  if (!(speed > 0 && Number.isFinite(speed))) throw fail(`travel takes a speed in metres a second, above 0; it was given ${speed}`);
}

/** The positions on the way, a second apart at `speed` metres a second: the first place first and the last last. */
export function route(places: readonly Place[], speed: number): Place[] {
  const [first, ...rest] = places;
  if (!first) return [];
  const positions: Place[] = [first];
  let from = first;
  for (const to of rest) {
    const seconds = Math.max(1, Math.ceil(distance(from, to) / speed));
    for (let second = 1; second <= seconds; second++) {
      const share = second / seconds;
      positions.push({latitude: from.latitude + (to.latitude - from.latitude) * share, longitude: from.longitude + (to.longitude - from.longitude) * share});
    }
    from = to;
  }
  return positions;
}
