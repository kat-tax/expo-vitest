// The connection: a banner over the notes while there is none, which goes
// when it comes back. Where a device cannot be taken offline the step is
// skipped, and the test says so rather than passing on nothing.
import {device, screen} from 'expo-vitest/device';
import {signedIn} from './helpers';

beforeEach(signedIn);

afterEach(async () => {
  await device.setNetwork('online');
});

it('says so while the device is offline, and stops when it is back', async ({skip}) => {
  if ((await device.setNetwork('offline')) === 'skipped') skip(`${device.platform} cannot be taken offline here`);
  await expect(screen.getByRole('alert')).toHaveText(/You are offline/);
  await device.setNetwork('online');
  await expect(screen.getByRole('alert')).toBeHidden();
});
