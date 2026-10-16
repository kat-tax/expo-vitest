/**
 * `device.open` in a unit test: the route handed to Expo Router's own
 * navigation, in an app `renderApp` mounted, so a step that opens a route
 * reads the same in a unit test as on a device.
 */
import {HarnessError} from '../harness/lib/errors.ts';

export async function openRoute(route: string, act: (work: () => void) => unknown): Promise<void> {
  let router: {navigate(href: string): void};
  try {
    ({router} = (await import('expo-router')) as unknown as {router: typeof router});
  } catch {
    throw new HarnessError('UNSUPPORTED_CAPABILITY', 'a unit test opens a route of an Expo Router app, and expo-router is not installed; render the screen instead');
  }
  await act(() => router.navigate(route));
}
