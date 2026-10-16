import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';

// Web by default; TESTAPP_PLATFORMS names others, as android,web.
const platforms = (process.env.TESTAPP_PLATFORMS?.split(',') ?? ['web']) as ('web' | 'android' | 'ios' | 'windows')[];

// An iOS simulator takes a minute or more to bring a development build up,
// and a second or more a step, so a test and its hooks get longer there.
export default defineConfig(deviceConfig({platforms, ...(platforms.includes('ios') ? {timeout: 240_000} : {})}));
