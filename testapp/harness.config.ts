import {defineHarness} from 'expo-vitest/device';

// The app the device tests drive. Web is served by Expo's dev server, which
// the run starts on a port of its own. A development build on Android or iOS
// loads from its own dev server, opened by the link expo-dev-client registers
// (docs/controls.md, An Expo development build); name the device with
// HARNESS_TARGET. Windows is the expo-windows build's exe, named the same way.
export default defineHarness({
  app: {
    web: {url: 'http://localhost:41751', command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']}},
    android: {
      bundleId: 'com.expovitest.testapp',
      scheme: 'testapp',
      url: 'http://localhost:41752',
      command: {executable: 'npx', args: ['expo', 'start', '--dev-client', '--port', '{port}'], env: {EXPO_NO_DEV_MENU: '1'}},
    },
    ios: {bundleId: 'com.expovitest.testapp', scheme: 'testapp'},
    windows: {scheme: 'testapp'},
  },
  assertionTimeout: 6000,
});
