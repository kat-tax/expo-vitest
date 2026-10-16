// The connection: a banner over the notes while there is none, which goes
// when it comes back. Where a device cannot be taken offline the step is
// skipped, and the test says so rather than passing on nothing.
import {device, screen} from 'expo-vitest/device';
import {signedIn} from './helpers';

/**
 * Takes the device off every network, or puts it back: the page on web, and
 * airplane mode on Android, where Wi-Fi off leaves an emulator on its mobile
 * data.
 */
const offline = (on: boolean) => (device.platform === 'android' ? device.setAirplaneMode(on) : device.setNetwork(on ? 'offline' : 'online'));
const banner = () => screen.getByText(/You are offline/);

beforeEach(signedIn);

afterEach(async () => {
  await offline(false);
});

it('says so while the device is offline, and stops when it is back', async ({skip}) => {
  if ((await offline(true)) === 'skipped') skip(`${device.platform} cannot be taken offline here`);
  await expect(banner()).toBeVisible();
  await offline(false);
  await expect(banner()).toBeHidden();
});
