import {defineHarness} from 'expo-vitest/config';
import {rules} from './device/rules.mts';

// The app the device tests drive. Web is served by Expo's dev server, which
// the run starts on a port of its own. A development build on Android or iOS
// loads from its own dev server, opened by the link expo-dev-client registers
// (docs/controls.md, An Expo development build); name the device with
// HARNESS_TARGET. Windows is the expo-windows build's exe, named the same way,
// which keeps its storage in %LOCALAPPDATA%/TestApp for clearState to delete.
// The agent acts with a model of rules, which needs no key, so an explore of
// the app (`expo-harness explore`) runs anywhere.
export default defineHarness({
  app: {
    web: {url: 'http://localhost:41751', command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']}},
    android: {
      bundleId: 'com.expovitest.testapp',
      scheme: 'testapp',
      url: 'http://localhost:41752',
      command: {executable: 'npx', args: ['expo', 'start', '--dev-client', '--port', '{port}'], env: {EXPO_NO_DEV_MENU: '1'}},
    },
    ios: {
      bundleId: 'com.expovitest.testapp',
      scheme: 'testapp',
      url: 'http://localhost:41754',
      command: {executable: 'npx', args: ['expo', 'start', '--dev-client', '--port', '{port}'], env: {EXPO_NO_DEV_MENU: '1'}},
    },
    windows: {scheme: 'testapp', ...(process.env.LOCALAPPDATA ? {stateDir: `${process.env.LOCALAPPDATA}/TestApp`} : {})},
  },
  assertionTimeout: 6000,
  agents: {
    default: {model: rules, context: 'A notes app: onboarding, sign-in with the demo account ada@example.com, notes with a search, and settings.'},
  },
});
