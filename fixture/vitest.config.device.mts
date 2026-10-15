import {defineConfig, mergeConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';

// The device tests, against the page device/serve.ts serves, as an app's
// device config is: by the package's name, with a globalSetup of its own.
export default defineConfig(mergeConfig(deviceConfig({assertionTimeout: 4000}), {test: {globalSetup: ['./device/serve.ts']}}));
