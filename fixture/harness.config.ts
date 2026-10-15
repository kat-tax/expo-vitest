import {defineHarness} from 'expo-vitest/device';

// The app the device tests drive, as an app's harness config names its own:
// the page device/serve.mjs serves, started for the run and stopped after.
export default defineHarness({
  app: {
    web: {url: 'http://127.0.0.1:41731', command: {executable: 'node', args: ['device/serve.mjs', '{port}']}},
  },
  assertionTimeout: 4000,
});
